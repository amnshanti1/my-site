# GLB Optimization Targets

Large homepage models should be optimized in a separate asset pass so visual changes can be reviewed independently from runtime code changes.

Current largest homepage assets:

- `public/models/Dynamo.glb` - 5.3 MB
- `public/models/droneIslandCOMPLETE.glb` - 4.9 MB
- `public/models/qf01full.glb` - 4.3 MB
- `public/models/PrimaryIslandv1.glb` - 3.8 MB
- `public/models/exposedwing.glb` - 1.5 MB

Recommended targets:

- Run `gltf-transform optimize` with mesh compression and texture resizing on copies first.
- Prefer Draco or Meshopt geometry compression for static meshes.
- Prefer KTX2/Basis texture compression where material textures dominate payload.
- Keep file names stable only after visual QA, because long-lived cache headers treat model URLs as immutable.
