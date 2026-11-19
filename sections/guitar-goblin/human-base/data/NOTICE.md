# Where this data comes from

`mesh.bin`, `mesh.json` and `targets.bin` are converted from assets of the MakeHuman project:

- repository: https://github.com/makehumancommunity/makehuman
- commit: a8bc2d54ff0ac92e78ff71431b1023eda42bf482
- files: `makehuman/data/3dobjs/base.obj`, and 132 morph targets under `makehuman/data/targets/`:
  `macrodetails/` (the gender and age shapes, the muscle and weight shapes for young adults), `macrodetails/height/`,
  `eyebrows/`, `forehead/`, `eyes/`, `nose/`, `mouth/`, `cheek/`, `chin/`, `head/`, `neck/`, `torso/`, `stomach/`,
  `armslegs/` (upper and lower arm fat and muscle) and `bodyshapes/` (one heavy male shape); 12 eyelid targets under
  `eyes/`; and the skeleton weights `makehuman/data/rigs/default_weights.mhw` (its own header: "license": "CC0"), from
  which `skin.bin` keeps, per vertex, how much follows the upper arm and how much the forearm.

Licence: **Creative Commons CC0 1.0 Universal** (public domain dedication). The repository's `LICENSE.md` (section C)
says the base mesh, proxies, targets and modifiers are released under CC0 1.0, and `LICENSE.ASSETS.md` holds the CC0
text. Each converted file's own header reads "This asset was explicitly released as CC0 in september 2020". The
copyright holders named at the time of release were Data Collection AB, Joel Palmius and Jonas Hauquier.

What was done to them:
- Only the `body` group of the base mesh is kept (all quads), with the two eye helper spheres (used to place our own
  eyes) and 33 of the joint helper cubes (used as landmarks).
- The three ethnic gender-and-age shapes are averaged in equal parts.
- Left and right halves of a target are summed into one.
- Every target is stored as 16-bit offsets with one scale each.

The converter is our own script.

MakeHuman's program code is under the AGPL; none of it is used, copied or adapted here. Everything that reads and uses
this data is our own: the loader, the morph blending, the subdivision, the landmarks, the skin, the eyes and the species
features, and the skinning that lowers the arms (`../base.js`, `../skin.js`, `../eyes.js`, `../species/`).
