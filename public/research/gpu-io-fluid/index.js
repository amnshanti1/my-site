// Main is called from ../common/wrapper.js
function main({ pane, contextID, glslVersion}) {
	const {
		GPUComposer,
		GPUProgram,
		GPULayer,
		SHORT,
		INT,
		FLOAT,
		REPEAT,
		NEAREST,
		LINEAR,
		CLAMP_TO_EDGE,
		renderSignedAmplitudeProgram,
	} = GPUIO;

	const INFLOW_DEFAULT_SPEED = 3;
	const EMBED_MODE = typeof window !== 'undefined' && window.parent && window.parent !== window;
	const ENABLE_POINTER_FORCES = false; // disable pointer forces for embed/perf
	const PARAMS = {
		trailLength: 1,
		render: 'Fluid',
		inflowSpeed: INFLOW_DEFAULT_SPEED,
		paused: EMBED_MODE ? true : false,
	};
	const telemetry = {
		outletMinSpeed: 0,
	};
	const AIRFOIL = {
		center: [0.55, 0.5],
		chord: 0.35,
		thickness: 0.12,
	};
	const INFLOW_WIDTH_RATIO = 0.04;
	const OUTFLOW_WIDTH_RATIO = 0.08;
	const OUTFLOW_DAMPING = 0.15;
	const TELEMETRY_INTERVAL_MS = 1000;
	const PRESSURE_SAMPLE_INTERVAL_MS = 500;
	// Scaling factor for touch interactions.
	const TOUCH_FORCE_SCALE = 2;
	// Approx avg num particles per px (reduced to lower GPU cost).
	const PARTICLE_DENSITY = 0.035;
	const MAX_NUM_PARTICLES = 50000;
	// How long do the particles last before they are reset.
	// If we don't have then reset they tend to clump up.
	const PARTICLE_LIFETIME = 100;
	// How many steps to compute the zero pressure field.
	const NUM_JACOBI_STEPS = 3;
	const PRESSURE_CALC_ALPHA = -1;
	const PRESSURE_CALC_BETA = 0.25;
	// How many steps to move particles between each step of the simulation.
	// This helps to make the trails look smoother in cases where the particles are moving >1 px per step.
	const NUM_RENDER_STEPS = 3;
	// Compute the velocity at a lower resolution to increase efficiency.
	const VELOCITY_SCALE_FACTOR = 3;
	// Put a speed limit on velocity, otherwise touch interactions get out of control.
	const MAX_VELOCITY = 30;
	// We are storing abs position (2 components) and displacements (2 components) in this buffer.
	// This decreases error when rendering to half float.
	const POSITION_NUM_COMPONENTS = 4;
	let velocityMaxObserved = Math.max(INFLOW_DEFAULT_SPEED * 2, 5);

	let shouldSavePNG = false;
	let telemetryPending = false;
	let pressureSamplePending = false;
	let lastTelemetrySample = 0;
	let lastPressureSample = 0;
	let pressureMaxAbs = 1;
	const canvas = document.createElement('canvas');
	if (EMBED_MODE) {
		canvas.style.pointerEvents = 'none';
	}
	document.body.appendChild(canvas);
	const obstacleOverlay = document.createElement('canvas');
	obstacleOverlay.style.position = 'absolute';
	obstacleOverlay.style.pointerEvents = 'none';
	obstacleOverlay.style.zIndex = 10;
	document.body.appendChild(obstacleOverlay);
	function redrawObstacleOverlay() {
		const rect = canvas.getBoundingClientRect();
		obstacleOverlay.width = rect.width;
		obstacleOverlay.height = rect.height;
		obstacleOverlay.style.left = `${rect.left}px`;
		obstacleOverlay.style.top = `${rect.top}px`;
		const ctx = obstacleOverlay.getContext('2d');
		ctx.clearRect(0, 0, rect.width, rect.height);
		ctx.strokeStyle = 'rgba(10, 10, 10, 0.5)';
		ctx.lineWidth = 2;
		ctx.shadowColor = 'rgba(0,0,0,0.3)';
		ctx.shadowBlur = 4;
		const chordPx = AIRFOIL.chord * rect.width;
		const centerX = AIRFOIL.center[0] * rect.width;
		const centerY = AIRFOIL.center[1] * rect.height;
		const startX = centerX - chordPx / 2;
		const samples = 80;
		ctx.beginPath();
		for (let i = 0; i <= samples; i++) {
			const t = i / samples;
			const localX = t;
			const thickness = nacaThickness(localX, AIRFOIL.thickness);
			const y = thickness * chordPx;
			const drawX = startX + localX * chordPx;
			const drawY = centerY - y;
			if (i === 0) ctx.moveTo(drawX, drawY);
			else ctx.lineTo(drawX, drawY);
		}
		for (let i = samples; i >= 0; i--) {
			const t = i / samples;
			const localX = t;
			const thickness = nacaThickness(localX, AIRFOIL.thickness);
			const y = thickness * chordPx;
			const drawX = startX + localX * chordPx;
			const drawY = centerY + y;
			ctx.lineTo(drawX, drawY);
		}
		ctx.closePath();
		ctx.stroke();
	}

	function calcNumParticles(width, height) {
		return Math.min(Math.ceil(width * height * ( PARTICLE_DENSITY)), MAX_NUM_PARTICLES);
	}
	function nacaThickness(x, thickness) {
		if (x < 0 || x > 1) return 0;
		const sqrtX = Math.sqrt(Math.max(x, 0));
		return 5 * thickness * (
			0.2969 * sqrtX -
			0.1260 * x -
			0.3516 * x * x +
			0.2843 * x * x * x -
			0.1015 * x * x * x * x
		);
	}
	function isInsideAirfoil(x, y, width, height) {
		const centerX = AIRFOIL.center[0] * width;
		const centerY = AIRFOIL.center[1] * height;
		const chordPx = AIRFOIL.chord * width;
		const startX = centerX - chordPx / 2;
		const localX = (x - startX) / chordPx;
		const localY = (y - centerY) / chordPx;
		const thickness = nacaThickness(localX, AIRFOIL.thickness);
		return Math.abs(localY) <= thickness;
	}
	let NUM_PARTICLES = calcNumParticles(canvas.width, canvas.height);

	const composer = new GPUComposer({ canvas, contextID, glslVersion });

	// Init state.
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	const velocityState = new GPULayer(composer, {
		name: 'velocity',
		dimensions: [Math.ceil(width / VELOCITY_SCALE_FACTOR), Math.ceil(height / VELOCITY_SCALE_FACTOR)],
		type: FLOAT,
		filter: LINEAR,
		numComponents: 2,
		wrapX: REPEAT,
		wrapY: CLAMP_TO_EDGE,
		numBuffers: 2,
	});
	const divergenceState = new GPULayer(composer, {
		name: 'divergence',
		dimensions: [velocityState.width, velocityState.height],
		type: FLOAT,
		filter: NEAREST,
		numComponents: 1,
		wrapX: REPEAT,
		wrapY: CLAMP_TO_EDGE,
	});
	const pressureState = new GPULayer(composer, {
		name: 'pressure',
		dimensions: [velocityState.width, velocityState.height],
		type: FLOAT,
		filter: NEAREST,
		numComponents: 1,
		wrapX: REPEAT,
		wrapY: CLAMP_TO_EDGE,
		numBuffers: 2,
	});
	const particlePositionState = new GPULayer(composer, {
		name: 'position',
		dimensions: NUM_PARTICLES,
		type: FLOAT,
		numComponents: POSITION_NUM_COMPONENTS,
		numBuffers: 2,
	});
	// We can use the initial state to reset particles after they've died.
	const particleInitialState = new GPULayer(composer, {
		name: 'initialPosition',
		dimensions: NUM_PARTICLES,
		type: FLOAT,
		numComponents: POSITION_NUM_COMPONENTS,
		numBuffers: 1,
	});
	const particleAgeState = new GPULayer(composer, {
		name: 'age',
		dimensions: NUM_PARTICLES,
		type: SHORT,
		numComponents: 1,
		numBuffers: 2,
	});
	// Init a render target for trail effect.
	const trailState = new GPULayer(composer, {
		name: 'trails',
		dimensions: [canvas.width, canvas.height],
		type: FLOAT,
		filter: NEAREST,
		numComponents: 1,
		numBuffers: 2,
	});

	// Init programs.
	const advection = new GPUProgram(composer, {
		name: 'advection',
		fragmentShader: `
		in vec2 v_uv;

		uniform sampler2D u_state;
		uniform sampler2D u_velocity;
		uniform vec2 u_dimensions;

		out vec2 out_state;

		void main() {
			// Implicitly solve advection.
			out_state = texture(u_state, v_uv - texture(u_velocity, v_uv).xy / u_dimensions).xy;
		}`,
		uniforms: [
			{
				name: 'u_state',
				value: 0,
				type: INT,
			},
			{
				name: 'u_velocity',
				value: 1,
				type: INT,
			},
			{
				name: 'u_dimensions',
				value: [canvas.width, canvas.height],
				type: FLOAT,
			},
		],
	});
	const divergence2D = new GPUProgram(composer, {
		name: 'divergence2D',
		fragmentShader: `
		in vec2 v_uv;

		uniform sampler2D u_vectorField;
		uniform vec2 u_pxSize;

		out float out_divergence;

		void main() {
			float n = texture(u_vectorField, v_uv + vec2(0, u_pxSize.y)).y;
			float s = texture(u_vectorField, v_uv - vec2(0, u_pxSize.y)).y;
			float e = texture(u_vectorField, v_uv + vec2(u_pxSize.x, 0)).x;
			float w = texture(u_vectorField, v_uv - vec2(u_pxSize.x, 0)).x;
			out_divergence = 0.5 * ( e - w + n - s);
		}`,
		uniforms: [
			{
				name: 'u_vectorField',
				value: 0,
				type: INT,
			},
			{
				name: 'u_pxSize',
				value: [1 / velocityState.width, 1 / velocityState.height],
				type: FLOAT,
			}
		],
	});
	const jacobi = new GPUProgram(composer, {
		name: 'jacobi',
		fragmentShader: `
		in vec2 v_uv;

		uniform float u_alpha;
		uniform float u_beta;
		uniform vec2 u_pxSize;
		uniform sampler2D u_previousState;
		uniform sampler2D u_divergence;

		out vec4 out_jacobi;

		void main() {
			vec4 n = texture(u_previousState, v_uv + vec2(0, u_pxSize.y));
			vec4 s = texture(u_previousState, v_uv - vec2(0, u_pxSize.y));
			vec4 e = texture(u_previousState, v_uv + vec2(u_pxSize.x, 0));
			vec4 w = texture(u_previousState, v_uv - vec2(u_pxSize.x, 0));
			vec4 d = texture(u_divergence, v_uv);
			out_jacobi = (n + s + e + w + u_alpha * d) * u_beta;
		}`,
		uniforms: [
			{
				name: 'u_alpha',
				value: PRESSURE_CALC_ALPHA,
				type: FLOAT,
			},
			{
				name: 'u_beta',
				value: PRESSURE_CALC_BETA,
				type: FLOAT,
			},
			{
				name: 'u_pxSize',
				value: [1 / velocityState.width, 1 / velocityState.height],
				type: FLOAT,
			},
			{
				name: 'u_previousState',
				value: 0,
				type: INT,
			},
			{
				name: 'u_divergence',
				value: 1,
				type: INT,
			},
		],
	});
	const gradientSubtraction = new GPUProgram(composer, {
		name: 'gradientSubtraction',
		fragmentShader: `
		in vec2 v_uv;

		uniform vec2 u_pxSize;
		uniform sampler2D u_scalarField;
		uniform sampler2D u_vectorField;

		out vec2 out_result;

		void main() {
			float n = texture(u_scalarField, v_uv + vec2(0, u_pxSize.y)).r;
			float s = texture(u_scalarField, v_uv - vec2(0, u_pxSize.y)).r;
			float e = texture(u_scalarField, v_uv + vec2(u_pxSize.x, 0)).r;
			float w = texture(u_scalarField, v_uv - vec2(u_pxSize.x, 0)).r;

			out_result = texture2D(u_vectorField, v_uv).xy - 0.5 * vec2(e - w, n - s);
		}`,
		uniforms: [
			{
				name: 'u_pxSize',
				value: [1 / velocityState.width, 1 / velocityState.height],
				type: FLOAT,
			},
			{
				name: 'u_scalarField',
				value: 0,
				type: INT,
			},
			{
				name: 'u_vectorField',
				value: 1,
				type: INT,
			},
		],
	});
	const applyInflowOutflow = new GPUProgram(composer, {
		name: 'applyInflowOutflow',
		fragmentShader: `
		in vec2 v_uv;

		uniform sampler2D u_velocity;
		uniform float u_inflowWidth;
		uniform float u_outflowWidth;
		uniform float u_inflowSpeed;
		uniform float u_outflowDamp;

		out vec2 out_velocity;

		void main() {
			vec2 freestream = vec2(u_inflowSpeed, 0.0);
			vec2 velocity = texture(u_velocity, v_uv).xy;
			float isInflow = step(v_uv.x, u_inflowWidth);
			float isOutflow = step(1.0 - u_outflowWidth, v_uv.x);
			vec2 result = mix(velocity, freestream, isInflow);
			vec2 nudgedOutflow = mix(result, freestream, u_outflowDamp);
			out_velocity = mix(result, nudgedOutflow, isOutflow);
		}
		`,
		uniforms: [
			{
				name: 'u_velocity',
				value: 0,
				type: INT,
			},
			{
				name: 'u_inflowWidth',
				value: INFLOW_WIDTH_RATIO,
				type: FLOAT,
			},
			{
				name: 'u_outflowWidth',
				value: OUTFLOW_WIDTH_RATIO,
				type: FLOAT,
			},
			{
				name: 'u_inflowSpeed',
				value: PARAMS.inflowSpeed,
				type: FLOAT,
			},
			{
				name: 'u_outflowDamp',
				value: OUTFLOW_DAMPING,
				type: FLOAT,
			},
		],
	});
	const applyObstacle = new GPUProgram(composer, {
		name: 'applyObstacle',
		fragmentShader: `
		in vec2 v_uv;

		uniform sampler2D u_velocity;
		uniform vec2 u_canvasSize;
		uniform vec2 u_centerNorm;
		uniform float u_chordNorm;
		uniform float u_thickness;

		out vec2 out_velocity;

		float nacaThickness(float x) {
			if (x < 0.0 || x > 1.0) return 0.0;
			float sqrtx = sqrt(max(x, 0.0));
			return 5.0 * u_thickness * (
				0.2969 * sqrtx -
				0.1260 * x -
				0.3516 * x * x +
				0.2843 * x * x * x -
				0.1015 * x * x * x * x
			);
		}

		void main() {
			vec2 velocity = texture(u_velocity, v_uv).xy;
			vec2 canvasSize = u_canvasSize;
			float chordPx = u_chordNorm * canvasSize.x;
			vec2 centerPx = u_centerNorm * canvasSize;
			float startX = centerPx.x - chordPx * 0.5;
			vec2 world = v_uv * canvasSize;
			float localX = (world.x - startX) / chordPx;
			float localY = (world.y - centerPx.y) / chordPx;
			float foilThickness = nacaThickness(localX);
			float inside = step(0.0, localX) * step(localX, 1.0) * step(abs(localY), foilThickness);
			out_velocity = mix(velocity, vec2(0.0), inside);
		}
		`,
		uniforms: [
			{
				name: 'u_velocity',
				value: 0,
				type: INT,
			},
			{
				name: 'u_canvasSize',
				value: [canvas.width, canvas.height],
				type: FLOAT,
			},
			{
				name: 'u_centerNorm',
				value: AIRFOIL.center,
				type: FLOAT,
			},
			{
				name: 'u_chordNorm',
				value: AIRFOIL.chord,
				type: FLOAT,
			},
			{
				name: 'u_thickness',
				value: AIRFOIL.thickness,
				type: FLOAT,
			},
		],
	});
	const renderParticles = new GPUProgram(composer, {
		name: 'renderParticles',
		fragmentShader: `
		#define FADE_TIME 0.1

		in vec2 v_uv;
		in vec2 v_uv_position;

		uniform isampler2D u_ages;
		uniform sampler2D u_velocity;

		out float out_state;

		void main() {
			float ageFraction = float(texture(u_ages, v_uv_position).x) / ${PARTICLE_LIFETIME.toFixed(1)};
			// Fade first 10% and last 10%.
			float opacity = mix(0.0, 1.0, min(ageFraction * 10.0, 1.0)) * mix(1.0, 0.0, max(ageFraction * 10.0 - 90.0, 0.0));
			vec2 velocity = texture(u_velocity, v_uv).xy;
			// Show the fastest regions with darker color.
			float multiplier = clamp(dot(velocity, velocity) * 0.05 + 0.7, 0.0, 1.0);
			out_state = opacity * multiplier;
		}`,
		uniforms: [
			{
				name: 'u_ages',
				value: 0,
				type: INT,
			},
			{
				name: 'u_velocity',
				value: 1,
				type: INT,
			},
		],
	});
	const ageParticles = new GPUProgram(composer, {
		name: 'ageParticles',
		fragmentShader: `
		in vec2 v_uv;

		uniform isampler2D u_ages;

		out int out_age;

		void main() {
			int age = texture(u_ages, v_uv).x + 1;
			out_age = stepi(age, ${PARTICLE_LIFETIME}) * age;
		}`,
		uniforms: [
			{
				name: 'u_ages',
				value: 0,
				type: INT,
			},
		],
	});
	const advectParticles = new GPUProgram(composer, {
		name: 'advectParticles',
		fragmentShader: `
		in vec2 v_uv;

		uniform vec2 u_dimensions;
		uniform sampler2D u_positions;
		uniform sampler2D u_velocity;
		uniform isampler2D u_ages;
		uniform sampler2D u_initialPositions;

		out vec4 out_position;

		void main() {
			// Store small displacements as separate number until they accumulate sufficiently.
			// Then add them to the absolution position.
			// This prevents small offsets on large abs positions from being lost in float16 precision.
			vec4 positionData = texture(u_positions, v_uv);
			vec2 absolute = positionData.rg;
			vec2 displacement = positionData.ba;
			vec2 position = absolute + displacement;

			// Forward integrate via RK2.
			vec2 pxSize = 1.0 / u_dimensions;
			vec2 velocity1 = texture(u_velocity, position * pxSize).xy;
			vec2 halfStep = position + velocity1 * 0.5 * ${1 / NUM_RENDER_STEPS};
			vec2 velocity2 = texture(u_velocity, halfStep * pxSize).xy;
			displacement += velocity2 * ${1 / NUM_RENDER_STEPS};

			// Merge displacement with absolute if needed.
			float shouldMerge = step(20.0, dot(displacement, displacement));
			vec2 mergedAbsolute = absolute + shouldMerge * displacement;
			float wrappedX = mod(mergedAbsolute.x + u_dimensions.x, u_dimensions.x);
			float clampedY = clamp(mergedAbsolute.y, 0.0, u_dimensions.y - 1.0);
			absolute = vec2(wrappedX, clampedY);
			displacement *= (1.0 - shouldMerge);

			// If this particle is being reset, give it a random position.
			int shouldReset = stepi(texture(u_ages, v_uv).x, 1);
			out_position = mix(vec4(absolute, displacement), texture(u_initialPositions, v_uv), float(shouldReset));
		}`,
		uniforms: [
			{
				name: 'u_positions',
				value: 0,
				type: INT,
			},
			{
				name: 'u_velocity',
				value: 1,
				type: INT,
			},
			{
				name: 'u_ages',
				value: 2,
				type: INT,
			},
			{
				name: 'u_initialPositions',
				value: 3,
				type: INT,
			},
			{
				name: 'u_dimensions',
				value: [canvas.width, canvas.height],
				type: 'FLOAT',
			},
		],
	});
	const fadeTrails = new GPUProgram(composer, {
		name: 'fadeTrails',
		fragmentShader: `
		in vec2 v_uv;

		uniform sampler2D u_image;
		uniform float u_increment;

		out float out_color;

		void main() {
			out_color = max(texture(u_image, v_uv).x + u_increment, 0.0);
		}`,
		uniforms: [
			{
				name: 'u_image',
				value: 0,
				type: INT,
			},
			{
				name: 'u_increment',
				value: -1 / PARAMS.trailLength,
				type: 'FLOAT',
			},
		],
	});
	const renderTrails = new GPUProgram(composer, {
		name: 'renderTrails',
		fragmentShader: `
			in vec2 v_uv;
			uniform sampler2D u_trailState;
			uniform sampler2D u_velocity;
			uniform float u_speedMax;
			out vec4 out_color;
			void main() {
				float intensity = texture(u_trailState, v_uv).x;
				vec2 vel = texture(u_velocity, v_uv).xy;
				float speed = length(vel);
				float speedNorm = clamp(speed / max(u_speedMax, 0.0001), 0.0, 1.0);
				// Bright blue (slow) to red (fast).
				vec3 cLow = vec3(0.0, 0.35, 1.0);
				vec3 cHigh = vec3(1.0, 0.0, 0.1);
				vec3 trailColor = mix(cLow, cHigh, speedNorm);
				float alpha = clamp(intensity * 1.4, 0.0, 1.0);
				out_color = vec4(trailColor, alpha);
			}
		`,
		uniforms: [
			{ name: 'u_trailState', value: 0, type: INT },
			{ name: 'u_velocity', value: 1, type: INT },
			{ name: 'u_speedMax', value: velocityMaxObserved, type: FLOAT },
		],
	});
	const renderPressure = new GPUProgram(composer, {
		name: 'renderPressure',
		fragmentShader: `
		in vec2 v_uv;
		uniform sampler2D u_pressure;
		uniform float u_maxAbs;
		out vec4 out_color;
		const vec3 POS_COLOR = vec3(0.85, 0.3, 0.3);
		const vec3 NEG_COLOR = vec3(0.2, 0.4, 0.9);
		const vec3 BASE_COLOR = vec3(0.95);
		void main() {
			float value = texture(u_pressure, v_uv).x;
			float maxAbs = max(u_maxAbs, 1e-5);
			float ratio = clamp(abs(value) / maxAbs, 0.0, 1.0);
			vec3 tint = value >= 0.0 ? POS_COLOR : NEG_COLOR;
			// Show only red/blue; alpha scales with magnitude.
			float alpha = ratio; // 0 at zero pressure, up to 1 at maxAbs
			out_color = vec4(tint, alpha);
		}
		`,
		uniforms: [
			{ name: 'u_pressure', value: 0, type: INT },
			{ name: 'u_maxAbs', value: pressureMaxAbs, type: FLOAT },
		],
	});

	// Render loop.
	function loop() {
		if (PARAMS.paused) {
			if (shouldSavePNG) {
				composer.savePNG({ filename: `fluid` });
				shouldSavePNG = false;
			}
			return;
		}
		// Advect the velocity vector field.
		composer.step({
			program: advection,
			input: [velocityState, velocityState],
			output: velocityState,
		});
		// Compute divergence of advected velocity field.
		composer.step({
			program: divergence2D,
			input: velocityState,
			output: divergenceState,
		});
		// Compute the pressure gradient of the advected velocity vector field (using jacobi iterations).
		for (let i = 0; i < NUM_JACOBI_STEPS; i++) {
			composer.step({
				program: jacobi,
				input: [pressureState, divergenceState],
				output: pressureState,
			});
		}
		// Subtract the pressure gradient from velocity to obtain a velocity vector field with zero divergence.
		composer.step({
			program: gradientSubtraction,
			input: [pressureState, velocityState],
			output: velocityState,
		});
		// Enforce steady inflow/outflow after the projection step.
		composer.step({
			program: applyInflowOutflow,
			input: velocityState,
			output: velocityState,
		});
		composer.step({
			program: applyObstacle,
			input: velocityState,
			output: velocityState,
		});

		if (PARAMS.render === 'Pressure') {
			composer.step({
				program: renderPressure,
				input: pressureState,
			});
		} else if (PARAMS.render === 'Velocity') {
			composer.drawLayerAsVectorField({
				layer: velocityState,
				vectorSpacing: 22, // fewer arrows (coarser grid)
				vectorScale: 3,
				color: [1.0, 0.25, 0.05], // bright orange-red
			});
		} else {
			// Increment particle age.
			composer.step({
				program: ageParticles,
				input: particleAgeState,
				output: particleAgeState,
			});
			// Fade current trails.
			composer.step({
				program: fadeTrails,
				input: trailState,
				output: trailState,
			});
			for (let i = 0; i < NUM_RENDER_STEPS; i++) {
				// Advect particles.
				composer.step({
					program: advectParticles,
					input: [particlePositionState, velocityState, particleAgeState, particleInitialState],
					output: particlePositionState,
				});
				// Render particles to texture for trail effect.
				composer.drawLayerAsPoints({
					layer: particlePositionState,
					program: renderParticles,
					input: [particleAgeState, velocityState],
					output: trailState,
					wrapX: true,
					wrapY: false,
				});
			}
			// Render particle trails to screen.
			composer.step({
				program: renderTrails,
				input: [trailState, velocityState],
			});
		}
		if (shouldSavePNG) {
			composer.savePNG({ filename: `fluid` });
			shouldSavePNG = false;
		}
	if (!telemetryPending && performance.now() - lastTelemetrySample >= TELEMETRY_INTERVAL_MS) {
		telemetryPending = true;
		updateOutletTelemetry();
	}
	const now = performance.now();
	if (!pressureSamplePending && now - lastPressureSample >= PRESSURE_SAMPLE_INTERVAL_MS) {
		pressureSamplePending = true;
		updatePressureStats();
	}
}

	// During touch, copy data from noise over to state.
	const touch = new GPUProgram(composer, {
		name: 'touch',
		fragmentShader: `
		in vec2 v_uv;
		in vec2 v_uv_local;

		uniform sampler2D u_velocity;
		uniform vec2 u_vector;

		out vec2 out_velocity;

		void main() {
			vec2 radialVec = (v_uv_local * 2.0 - 1.0);
			float radiusSq = dot(radialVec, radialVec);
			vec2 velocity = texture(u_velocity, v_uv).xy + (1.0 - radiusSq) * u_vector * ${TOUCH_FORCE_SCALE.toFixed(1)};
			float velocityMag = length(velocity);
			out_velocity = velocity / velocityMag * min(velocityMag, ${MAX_VELOCITY.toFixed(1)});
		}`,
		uniforms: [
			{
				name: 'u_velocity',
				value: 0,
				type: INT,
			},
			{
				name: 'u_vector',
				value: [0, 0],
				type: FLOAT,
			},
		],
	});

	// Touch events.
	const activeTouches = {};
	function onPointerMove(e) {
		const x = e.clientX;
		const y = e.clientY;
		if (activeTouches[e.pointerId] === undefined) {
			activeTouches[e.pointerId] = {
				current: [x, y],
			}
			return;
		}
		activeTouches[e.pointerId].last = activeTouches[e.pointerId].current;
		activeTouches[e.pointerId].current = [x, y];

		const { current, last } = activeTouches[e.pointerId];
		if (current[0] == last[0] && current[1] == last[1]) {
			return;
		}
		touch.setUniform('u_vector', [current[0] - last[0], - (current[1] - last[1])]);
		composer.stepSegment({
			program: touch,
			input: velocityState,
			output: velocityState,
			position1: [current[0], canvas.clientHeight - current[1]],
			position2: [last[0], canvas.clientHeight - last[1]],
			thickness: 30,
			endCaps: true,
		});
	}
	function onPointerStop(e) {
		delete activeTouches[e.pointerId];
	}
	if (ENABLE_POINTER_FORCES) {
		canvas.addEventListener('pointermove', onPointerMove);
		canvas.addEventListener('pointerup', onPointerStop);
		canvas.addEventListener('pointerout', onPointerStop);
		canvas.addEventListener('pointercancel', onPointerStop);
	}

	const ui = [];
	ui.push(pane.addInput(PARAMS, 'trailLength', { min: 0, max: 100, step: 1, label: 'Trail Length' }).on('change', () => {
		fadeTrails.setUniform('u_increment', -1 / PARAMS.trailLength);
	}));
	ui.push(pane.addInput(PARAMS, 'inflowSpeed', { min: 0, max: 60, step: 1, label: 'Inflow Speed' }).on('change', () => {
		applyInflowOutflow.setUniform('u_inflowSpeed', PARAMS.inflowSpeed);
	}));
	ui.push(pane.addInput(PARAMS, 'paused', {
		label: 'Pause Simulation',
	}).on('change', () => {
		telemetryPending = false;
	}));
	ui.push(pane.addMonitor(telemetry, 'outletMinSpeed', {
		label: 'Outlet Min Speed',
		format: (v) => v.toFixed(2),
	}));
	ui.push(pane.addInput(PARAMS, 'render', {
		options: {
			Fluid: 'Fluid',
			Pressure: 'Pressure',
			Velocity: 'Velocity',
		},
		label: 'Render',
	}));
	ui.push(pane.addButton({ title: 'Reset' }).on('click', onResize));
	ui.push(pane.addButton({ title: 'Save PNG (p)' }).on('click', savePNG));
	if (EMBED_MODE) {
		pane.hidden = true;
	}

	// Add 'p' hotkey to print screen.
	function savePNG() {
		shouldSavePNG = true;
	}
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('message', onParentMessage);
	function onKeydown(e) {
		switch (e.key) {
			case 'p':
				savePNG();
				break;
			case ' ':
			case 'Spacebar':
				PARAMS.paused = !PARAMS.paused;
				pane.refresh();
				telemetryPending = false;
				break;
		}
	}
	function sendReady() {
		if (window.parent && window.parent !== window) {
			window.parent.postMessage({ type: 'fluid-ready' }, '*');
		}
	}
	function sendAck(event, payload) {
		if (!event.source || typeof event.source.postMessage !== 'function') return;
		event.source.postMessage(payload, '*');
	}
	// Wrapper already ticks every frame; this is a no-op placeholder to avoid errors when unpausing from parent.
	function scheduleFluidFrame() {}
	function onParentMessage(event) {
		const { data } = event;
		if (!data || typeof data !== 'object') return;
		const { type, mode, command, value, requestId } = data;
		if (type === 'fluid-display-mode' && typeof mode === 'string') {
			if (mode === 'Fluid' || mode === 'Pressure' || mode === 'Velocity') {
				PARAMS.render = mode;
				pane.refresh();
			}
			return;
		}
		if (type === 'fluid-control' && command === 'setPaused') {
			if (typeof value === 'boolean') {
				PARAMS.paused = value;
				pane.refresh();
				telemetryPending = false;
				if (!PARAMS.paused) {
					scheduleFluidFrame();
				}
			}
			if (typeof requestId === 'number') {
				sendAck(event, { type: 'fluid-control-ack', command, value: !!value, requestId });
			}
			return;
		}
		if (type === 'fluid-control' && command === 'setRenderMode' && typeof value === 'string') {
			if (value === 'Fluid' || value === 'Pressure' || value === 'Velocity') {
				PARAMS.render = value;
				pane.refresh();
			}
			if (typeof requestId === 'number') {
				sendAck(event, { type: 'fluid-control-ack', command, value, requestId });
			}
			return;
		}
		if (type === 'fluid-control' && command === 'getStatus') {
			sendAck(event, {
				type: 'fluid-control-ack',
				command,
				value: {
					paused: !!PARAMS.paused,
					render: PARAMS.render,
				},
				requestId,
			});
		}
	}

	// Resize if needed.
	window.addEventListener('resize', onResize);
	function onResize() {
		const width = window.innerWidth;
		const height = window.innerHeight;

		// Resize composer.
		composer.resize([width, height]);

		// Re-init textures at new size.
		const velocityDimensions = [Math.ceil(width / VELOCITY_SCALE_FACTOR), Math.ceil(height / VELOCITY_SCALE_FACTOR)];
		velocityState.resize(velocityDimensions);
		divergenceState.resize(velocityDimensions);
		pressureState.resize(velocityDimensions);
		trailState.resize([width, height]);

		// Update uniforms.
		advection.setUniform('u_dimensions', [width, height]);
		advectParticles.setUniform('u_dimensions', [width, height]);
		applyObstacle.setUniform('u_canvasSize', [width, height]);
		const velocityPxSize = [1 / velocityDimensions[0], 1 / velocityDimensions[1]];
		divergence2D.setUniform('u_pxSize', velocityPxSize);
		jacobi.setUniform('u_pxSize', velocityPxSize);
		gradientSubtraction.setUniform('u_pxSize', velocityPxSize);
		
		// Re-init particles.
		NUM_PARTICLES = calcNumParticles(width, height);
		// Init new positions.
		const positions = new Float32Array(NUM_PARTICLES * 4);
		for (let i = 0; i < positions.length / 4; i++) {
			let x, y, attempts = 0;
			do {
				x = Math.random() * width;
				y = Math.random() * height;
				attempts++;
			} while (isInsideAirfoil(x, y, width, height) && attempts < 10);
			if (isInsideAirfoil(x, y, width, height)) {
				x = Math.min(Math.max(AIRFOIL.center[0] * width + (AIRFOIL.chord * width / 2) + 5, 0), width);
			}
			positions[POSITION_NUM_COMPONENTS * i] = x;
			positions[POSITION_NUM_COMPONENTS * i + 1] = y;
		}
		particlePositionState.resize(NUM_PARTICLES, positions);
		particleInitialState.resize(NUM_PARTICLES, positions);
		// Init new ages.
		const ages = new Int16Array(NUM_PARTICLES);
		for (let i = 0; i < NUM_PARTICLES; i++) {
			ages[i] = Math.round(Math.random() * PARTICLE_LIFETIME);
		}
		particleAgeState.resize(NUM_PARTICLES, ages);
		redrawObstacleOverlay();
		requestPressureStats();
	}
	onResize();
	// Signal readiness to parent if embedded.
	requestAnimationFrame(sendReady);

	function computeInletOutletStats(values, width, height, components) {
		const inletCols = Math.max(1, Math.floor(width * INFLOW_WIDTH_RATIO));
		const outletCols = Math.max(1, Math.floor(width * OUTFLOW_WIDTH_RATIO));
		const outletStart = Math.max(0, width - outletCols);
		const sample = (x, y) => {
			const index = (y * width + x) * components;
			const vx = values[index];
			const vy = components > 1 ? values[index + 1] : 0;
			return [vx, vy];
		};
		let inletMaxLongitudinalError = 0;
		let inletMaxNormalSpeed = 0;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < inletCols; x++) {
				const [vx, vy] = sample(x, y);
				inletMaxLongitudinalError = Math.max(inletMaxLongitudinalError, Math.abs(vx - PARAMS.inflowSpeed));
				inletMaxNormalSpeed = Math.max(inletMaxNormalSpeed, Math.abs(vy));
			}
		}
		let outletMinSpeed = Infinity;
		for (let y = 0; y < height; y++) {
			for (let x = outletStart; x < width; x++) {
				const [vx] = sample(x, y);
				outletMinSpeed = Math.min(outletMinSpeed, vx);
			}
		}
		if (!Number.isFinite(outletMinSpeed)) {
			outletMinSpeed = 0;
		}
		return {
			inletMaxLongitudinalError,
			inletMaxNormalSpeed,
			outletMinSpeed,
		};
	}

	async function runInflowOutflowTest() {
		const values = await velocityState.getValuesAsync();
		const width = velocityState.width;
		const height = velocityState.height;
		const components = velocityState.numComponents;
		const stats = computeInletOutletStats(values, width, height, components);
		const inflowSpeedTarget = PARAMS.inflowSpeed;
		const toleranceBase = Math.max(1, inflowSpeedTarget);
		const inletPass = stats.inletMaxLongitudinalError <= toleranceBase * 0.2 && stats.inletMaxNormalSpeed <= toleranceBase * 0.05;
		const outletPass = stats.outletMinSpeed >= inflowSpeedTarget * (1 - OUTFLOW_DAMPING * 2.0);
		const result = {
			targetSpeed: inflowSpeedTarget,
			inletPass,
			outletPass,
			inletMaxLongitudinalError: stats.inletMaxLongitudinalError,
			inletMaxNormalSpeed: stats.inletMaxNormalSpeed,
			outletMinSpeed: stats.outletMinSpeed,
		};
		console.log('[wind tunnel] inflow/outflow test', result);
		return result;
	}

async function updateOutletTelemetry() {
	try {
		const values = await velocityState.getValuesAsync();
		const stats = computeInletOutletStats(values, velocityState.width, velocityState.height, velocityState.numComponents);
		telemetry.outletMinSpeed = stats.outletMinSpeed;
		// Compute max speed for dynamic colormap.
		let maxSpeed = 0;
		for (let i = 0; i < values.length; i += velocityState.numComponents) {
			const vx = values[i];
			const vy = values[i + 1] || 0;
			const s = Math.hypot(vx, vy);
			if (s > maxSpeed) maxSpeed = s;
		}
		if (maxSpeed > 0) {
			velocityMaxObserved = maxSpeed;
			renderTrails.setUniform('u_speedMax', Math.max(maxSpeed, 1e-3));
		}
	} catch (error) {
		console.warn('Failed to sample outlet min speed', error);
	} finally {
		telemetryPending = false;
		lastTelemetrySample = performance.now();
	}
}
async function updatePressureStats() {
	try {
		const values = await pressureState.getValuesAsync();
		let maxAbs = 0;
		for (let i = 0; i < values.length; i += pressureState.numComponents) {
			const val = Math.abs(values[i]);
			if (val > maxAbs) maxAbs = val;
		}
		pressureMaxAbs = Math.max(maxAbs, 1e-3);
		renderPressure.setUniform('u_maxAbs', pressureMaxAbs);
	} catch (error) {
		console.warn('Failed to sample pressure stats', error);
	} finally {
		pressureSamplePending = false;
		lastPressureSample = performance.now();
	}
}
function requestPressureStats() {
	if (pressureSamplePending) return;
	pressureSamplePending = true;
	updatePressureStats();
}
	window.windTunnelTests = window.windTunnelTests || {};
	window.windTunnelTests.runInflowOutflowTest = runInflowOutflowTest;

	function dispose() {
		document.body.removeChild(canvas);
		document.body.removeChild(obstacleOverlay);
		window.removeEventListener('keydown', onKeydown);
		window.removeEventListener('resize', onResize);
		canvas.removeEventListener('pointermove', onPointerMove);
		canvas.removeEventListener('pointerup', onPointerStop);
		canvas.removeEventListener('pointerout', onPointerStop);
		canvas.removeEventListener('pointercancel', onPointerStop);
		velocityState.dispose();
		divergenceState.dispose();
		pressureState.dispose();
		particlePositionState.dispose();
		particleInitialState.dispose();
		particleAgeState.dispose();
		trailState.dispose();
		advection.dispose();
		divergence2D.dispose();
		jacobi.dispose();
		gradientSubtraction.dispose();
		applyInflowOutflow.dispose();
		applyObstacle.dispose();
		renderParticles.dispose();
		ageParticles.dispose();
		advectParticles.dispose();
		renderTrails.dispose();
		fadeTrails.dispose();
		renderPressure.dispose();
		touch.dispose();
		composer.dispose();
		ui.forEach(el => {
			pane.remove(el);
		});
		ui.length = 0;
	}

	return {
		loop,
		dispose,
		composer,
		canvas,
	};
}
