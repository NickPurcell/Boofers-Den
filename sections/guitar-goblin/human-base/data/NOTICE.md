# Where this data comes from

`mesh.bin`, `mesh.json`, `targets.bin`, `skin.bin` and `bones.bin` are converted from assets of the MakeHuman project:

- repository: https://github.com/makehumancommunity/makehuman
- commit: a8bc2d54ff0ac92e78ff71431b1023eda42bf482
- files: `makehuman/data/3dobjs/base.obj`, and 146 morph targets under `makehuman/data/targets/`:
  `macrodetails/` (the gender and age shapes, the muscle and weight shapes for young adults), `macrodetails/height/`,
  `eyebrows/`, `forehead/`, `eyes/`, `nose/`, `mouth/`, `cheek/`, `chin/`, `head/`, `neck/`, `torso/`, `stomach/`,
  `armslegs/` (upper and lower arm fat and muscle) and `bodyshapes/` (one heavy male shape); 14 ear targets under `ears/`; 12 eyelid targets under
  `eyes/`; and the skeleton weights `makehuman/data/rigs/default_weights.mhw` (its own header: "license": "CC0"), from
  which `skin.bin` keeps, per vertex, how much follows the upper arm, the forearm, the fingers and the thumb; and the
  skeleton `makehuman/data/rigs/default.mhskel` (its own header: "license": "CC0"), of which 38 bones are kept
  (`mesh.json`'s `skeleton`: each bone's parent and the vertices that place its joints), with `bones.bin` holding, per
  vertex, the four kept bones that move it most and their weights, from the same weights file.

Licence: **Creative Commons CC0 1.0 Universal** (public domain dedication). The repository's `LICENSE.md` (section C)
says the base mesh, proxies, targets and modifiers are released under CC0 1.0, and `LICENSE.ASSETS.md` holds the CC0
text. Each converted file's own header reads "This asset was explicitly released as CC0 in september 2020". The
copyright holders named at the time of release were Data Collection AB, Joel Palmius and Jonas Hauquier.

`derived.json` holds tables worked out from that data by our own code (`../derive.js`, run at build time by our
`tests/human-base/bake.mjs`): the landmarks, the regions, the hand mask, the eye rings, the Pureblood's ridges and roots, and the order to fold the
body's vertices away in for a coarser figure (the one drawn on the table).

What was done to them:
- Only the `body` group of the base mesh is kept (all quads), with the two eye helper spheres (used to place our own
  eyes), 33 of the joint helper cubes (used as landmarks) and the joint vertices the kept bones name.
- The three ethnic gender-and-age shapes are averaged in equal parts.
- Left and right halves of a target are summed into one.
- Every target is stored as 16-bit offsets with one scale each.

The converter is our own script (`tests/human-base/convert.py`), and the check that `derived.json` still matches the data runs with the tests (`tests/human-base.test.js`).

The carried things (`../carry.js`) use no MakeHuman data: they are our own shapes, built with the droid page's kit.

MakeHuman's program code is under the AGPL; none of it is used, copied or adapted here. Everything that reads and uses
this data is our own: the loader, the morph blending, the subdivision, the landmarks, the skin, the eyes and the species
features, and the skinning that lowers the arms, the coarser figure baked for the table, and the run and the stand, written as joint
turns in our own code with no motion data (`../base.js`, `../skin.js`, `../eyes.js`, `../species/`, `../table.js`,
`../motion.js`).

## Animation clips (`clips.json`)

`clips.json` holds animation clips mapped onto our skeleton by our own build script (`tests/human-base/clips-build.mjs`)
from the human animations of the Mesh2Motion project:

- repository: https://github.com/Mesh2Motion/mesh2motion-app
- commit: 1632e1a7e009600500d436628075aa3a0e8b36ac
- files: `static/assets/human/animations/` `idle-a.glb`, `fighting-idle.glb`, `jog.glb`, `walk.glb`,
  `sword-regular-a.glb`, `sword-regular-a-rec.glb`, `sword-block.glb`, `two-handed-horizontal-swing.glb`,
  `two-handed-overhead-slam.glb`, `staff-combo.glb`, `staff-spin.glb`, `pistol-shoot.glb`, `rifle-fire.glb`,
  `spell-simple-enter.glb`, `spell-simple-shoot.glb`, `spell-simple-exit.glb`, `two-hand-blast.glb`, `power-burst.glb`,
  `hit-chest.glb`, `hit-head.glb`, `death-a.glb`, `dodge-left.glb`, `weapon-draw.glb`, `pistol-idle.glb`, `punch-jab.glb`, `punch-cross.glb`, `death-d.glb`, `laytoidle.glb` (the name each clip came from is
  kept in `clips.json` beside it)

Fetched on 19 November 2026 at that commit, as data only.

Licence: **Creative Commons CC0 1.0 Universal**. The repository's `LICENSE-CC0.MD` reads "All 3d models, blend files,
rigs, animations / CC0 1.0 Universal", and its README: "The art assets (3d models, rigs, animations) are all licensed
under CC0." Many of these clips originate in Quaternius's Universal Animation Library, which Quaternius released under
CC0 and Mesh2Motion took in under CC0. Only our converted clip data is shipped here, never their GLB files. None of
Mesh2Motion's program code is used, copied or adapted (the mapping is our own, `../clips.js`).

What was done to them: each clip's bone turns were read, the turns of the 22 bones that match ours kept (as each bone's
turn away from the clip's rest pose, in 16-bit integers), and the hips kept in units of the clip's own hip height; the
fingers, and anything else without a bone of ours, are dropped. The GLBs pack their tracks with EXT_meshopt_compression,
unpacked at build time by meshoptimizer's decoder (MIT, https://github.com/zeux/meshoptimizer), which is not shipped.
The player that maps them onto each figure is our own (`../clips.js`). Nothing is fetched at run time.
