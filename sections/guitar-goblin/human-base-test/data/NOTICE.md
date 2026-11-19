# Where this data comes from

`mesh.bin`, `mesh.json` and `targets.bin` are converted from assets of the MakeHuman project:

- repository: https://github.com/makehumancommunity/makehuman
- commit: a8bc2d54ff0ac92e78ff71431b1023eda42bf482
- files: `makehuman/data/3dobjs/base.obj` and 95 morph targets under `makehuman/data/targets/`
  (`macrodetails/`, `macrodetails/height/`, `eyebrows/`, `forehead/`, `eyes/`, `nose/`, `mouth/`, `cheek/`, `chin/`,
  `head/`, `neck/`, `torso/`)

Those assets are released under **Creative Commons CC0 1.0 Universal** (public domain dedication). The repository's
`LICENSE.ASSETS.md` holds the CC0 text, and each file's own header reads "This asset was explicitly released as CC0 in
september 2020". The copyright holders named at the time of release were Data Collection AB, Joel Palmius and Jonas
Hauquier.

What was done to them: only the `body` group of the base mesh is kept (and the two eye helper spheres, used to place
our own eyes); quads are split into triangles; the three ethnic gender-and-age shapes are averaged in equal parts;
left and right halves of a facial target are summed into one; every target is stored as 16-bit offsets with one
scale each. The converter is our own script.

MakeHuman's program code is under the AGPL and none of it is used here. The loader, the morph blending, the
materials, the eyes and the page (`../hb.js`, `../index.html`, `../hb.css`) are our own.
