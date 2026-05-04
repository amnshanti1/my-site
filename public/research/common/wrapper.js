'use strict';
(function bootstrapGpuIoWrapper() {
	function initWrapper() {
		const EMBED_MODE = typeof window !== 'undefined' && window.parent && window.parent !== window;
		if (typeof GPUIO === 'undefined') {
			requestAnimationFrame(initWrapper);
			return;
		}
		const {
			GLSL1,
			GLSL3,
			WEBGL1,
			WEBGL2,
			isWebGL2Supported,
		} = GPUIO;

		const CanvasCapture = window.CanvasCapture.CanvasCapture;
		const RECORD_FPS = 60;

		const pane = new Tweakpane.Pane();
		const paneToggle = new Tweakpane.Pane();
		paneToggle.expanded = false;
		paneToggle.addButton({ title: 'Show Controls' }).on('click', () => {
			paneToggle.expanded = false;
			pane.expanded = true;
		});
		pane.addButton({ title: 'Hide Controls'}).on('click', () => {
			pane.expanded = false;
			paneToggle.expanded = true;
		});
		if (EMBED_MODE) {
			pane.hidden = true;
			paneToggle.hidden = true;
		}

		MicroModal.init();

		const overlay = document.createElement('div');
		overlay.id = 'touchOverlay';
		overlay.style.width = '100%';
		overlay.style.height = '100%'
		overlay.style.opacity = 0;
		overlay.style.position = 'absolute';
		overlay.style['z-index'] = 1;
		overlay.style.display = 'none';
		document.body.append(overlay);

		const webGLSettings = {
			webGLVersion: isWebGL2Supported() ? 'WebGL 2' : 'WebGL 1',
			GLSLVersion: isWebGL2Supported() ? 'GLSL 3' : 'GLSL 1',
		};
		const availableWebGLVersions = { webgl1: 'WebGL 1' };
		const availableGLSLVersions = { glsl1: 'GLSL 1' };
		if (isWebGL2Supported()) {
			availableWebGLVersions.webgl2 = 'WebGL 2';
			availableGLSLVersions.glsl3 = 'GLSL 3';
		}
	let loop, dispose, composer, canvas, isPausedRef;
	let title = webGLSettings.webGLVersion;
	let useGLSL3Toggle;
	function reloadExampleWithNewParams() {
		if (useGLSL3Toggle) {
			useGLSL3Toggle.dispose();
			useGLSL3Toggle = undefined;
		}
		if (canvas) {
			canvas.addEventListener('gesturestart', disableZoom);
			canvas.addEventListener('gesturechange', disableZoom); 
			canvas.addEventListener('gestureend', disableZoom);
		}
		if (webGLSettings.webGLVersion === 'WebGL 1') webGLSettings.GLSLVersion = 'GLSL 1';
		if (dispose) dispose();
		({ loop, composer, dispose, canvas, isPaused: isPausedRef } = main({
			pane,
			contextID: webGLSettings.webGLVersion === 'WebGL 2' ? WEBGL2 : WEBGL1,
			glslVersion: webGLSettings.GLSLVersion === 'GLSL 3' ? GLSL3 : GLSL1,
		}));
		if (typeof isPausedRef !== 'function') {
			isPausedRef = undefined;
		}
		canvas.addEventListener('gesturestart', disableZoom);
		canvas.addEventListener('gesturechange', disableZoom); 
		canvas.addEventListener('gestureend', disableZoom);
		
		useGLSL3Toggle = settings.addInput(
			webGLSettings,
			'GLSLVersion',
			{
				options: webGLSettings.webGLVersion === 'WebGL 2' ? availableGLSLVersions : { glsl1: 'GLSL 1' },
				label: 'GLSL Version',
			}).on('change', () => {
				setTimeout(reloadExampleWithNewParams, 10);
			});
		title = `${webGLSettings.webGLVersion}`;
		settings.title = title;

		if (!EMBED_MODE) {
			CanvasCapture.dispose();
			CanvasCapture.init(canvas, { showRecDot: true, showDialogs: true, showAlerts: true, recDotCSS: { left: '0', right: 'auto' } });
			CanvasCapture.bindKeyToVideoRecord('v', {
				format: CanvasCapture.WEBM,
				name: 'screen_recording',
				fps: RECORD_FPS,
				quality: 1,
			});
		}
	}
	const settings = pane.addFolder({
		title,
		expanded: false,
	});
	settings.addInput(webGLSettings, 'webGLVersion', {
		options: availableWebGLVersions,
		label: 'WebGL Version',
	}).on('change', reloadExampleWithNewParams);

	const modalOptions = {
		showModal: () => {
			MicroModal.show('modal-1', { onClose: () => { setTimeout(() => { overlay.style.display = 'none'; }, 500); } });
			overlay.style.display = 'block';
		},
		sourceCode: () => {
			document.getElementById('sourceCode').click();
		},
	}
	pane.addButton({ title: 'About'}).on('click', modalOptions.showModal);
	pane.addButton({ title: 'View Code'}).on('click', modalOptions.sourceCode);
	reloadExampleWithNewParams();
	function disableZoom(e) {
		e.preventDefault();
		const scale = 'scale(1)';
		document.body.style.webkitTransform =  scale;
		document.body.style.msTransform =   scale;
		document.body.style.transform = scale;
	}
	let numFrames = 0;
	function outerLoop() {
		const paused = isPausedRef ? isPausedRef() : false;
		if (!paused) {
			const { fps, numTicks } = composer.tick();
			if (numTicks % 10 === 0) {
				settings.title = `${title} (${fps.toFixed(1)} FPS)`;
			}
			if (loop) loop();
			if (CanvasCapture.isRecording()) {
				CanvasCapture.recordFrame();
				numFrames++;
				console.log(`Recording duration: ${(numFrames / RECORD_FPS).toFixed(2)} sec`);
			} else {
				numFrames = 0;
			}
		} else {
			numFrames = 0;
		}
		if (!EMBED_MODE) {
			CanvasCapture.checkHotkeys();
		}
		window.requestAnimationFrame(outerLoop);
	}
	outerLoop();
	}
	initWrapper();
})();
