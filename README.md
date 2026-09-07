# Human Atlas

An interactive 3D anatomy explorer built with React, Three.js, and shadcn/ui. Take the BodyParts3D adult male reference apart into **2,234 individually selectable meshes**, explore **15 anatomical systems**, and search **3,432 named concepts**.

**[Explore the live demo](https://human-atlas-seven.vercel.app)**

## Explore

- Orbit, zoom, and select structures directly on the body.
- Toggle individual systems or use skeleton and organ presets.
- Move from assembled anatomy to a spaced inventory of every visible piece.
- Search anatomical names and source identifiers.
- Isolate a selected structure and read its details.
- Use compact controls and detail panels on mobile.

## Run locally

Requires Node.js 22.13 or newer. No API keys or accounts are needed.

```sh
npm ci
npm run dev
```

Open http://localhost:3016. To build the static site, run `npm run build`; the output is in `dist/`.

## Validate

```sh
npm run check
node scripts/validate-atlas.mjs
node scripts/validate-interactions.mjs
node scripts/validate-radiograph.mjs
node scripts/validate-imaging.mjs
npm run build
```

Validation covers mesh buffers, names and concept membership, nonoverlapping exploded layouts at desktop and mobile aspect ratios, search and inspection contracts, and tap-versus-drag handling. It also covers the radiograph's attenuation model and beam integration, and the imaging studies: manifest integrity, that every label names a declared structure, section geometry and sampling in each plane, and that each labelled organ's mean Hounsfield value is right for its name, which is what would catch a mask drifting out of register with its image. Browser interaction checks have exercised selection, system controls, search, isolation, rotation, and 390×844, 320×568, and 844×390 layouts. Phone controls stay clear of the exploded inventory, and isolated structures fit the space above or beside the detail panel. Physical-device performance and real multitouch hardware have not been tested.

## Anatomy data

The current viewer uses **BodyParts3D 4.0**, an adult male reference anatomy, licensed **CC BY 4.0**. It does not represent every human structure or variation. Individual source meshes are distinct from named concepts, which may group multiple meshes. Descriptions distinguish general system context from individual organ explanations.

Geometry is simplified for browser performance while retaining every source mesh. The packaged model contains 2,288,268 triangles and downloads approximately 33 MB of compressed geometry. Full credits, source links, and adaptation details are in [ATTRIBUTION.md](public/ATTRIBUTION.md).

## Imaging data

The radiograph is **computed from the meshes**: attenuation summed along each ray at a 70 keV effective beam energy. It is a model of a projection, not an acquired film.

CT and MRI are **real studies**, each one anonymised subject shown with the segmentations a radiologist refined, so the structure named under the pointer was drawn by a person. The CT reads in true Hounsfield units, which is why the window presets behave as they do on a console. Volumes are fetched only when their modality is first opened.

| | Source | Subject | Coverage | Structures | Sampling | Licence |
|---|---|---|---|---|---|---|
| CT | [TotalSegmentator](https://doi.org/10.5281/zenodo.10047292) | s0287 | neck to lower leg, 125 cm | 102 of 117 | 184×501×148 at 2.5 mm | CC BY 4.0 |
| MRI · T1 | [TotalSegmentator MRI](https://doi.org/10.5281/zenodo.11367005) | s0175 | head to thigh, 108 cm | 53 of 56 | 320×360×240 at 1.28×3.0×1.28 mm | **CC BY-NC-SA 2.0** |
| MRI · STIR | [TotalSegmentator MRI](https://doi.org/10.5281/zenodo.11367005) | s0190 | chest to pelvis, 50 cm | 34 of 56 | 384×384×39 at 1.3×1.3×6.0 mm | **CC BY-NC-SA 2.0** |

**No single clinical study covers head to toe.** CT and MRI are acquired per body region, and even a protocol called whole body stops at the thighs. These are the widest acquisitions in either collection: the CT reaches from the neck to the lower legs, the T1 from the crown to mid-thigh. Neither includes both the head and the feet, and that is a property of how the studies were acquired rather than of this viewer.

An MR sequence is not a display setting. One acquisition carries one weighting, so T1 and STIR here are two separate studies of two different patients, each labelled with the weighting **measured from its own tissue signals** rather than read from metadata this collection records in mixed units. On T1 urine is dark against liver; on STIR fat is nulled and fluid is bright.

These are clinical studies, so they carry incidental findings. The STIR study has a visible lesion in the left axilla. They show real anatomy, not idealised anatomy.

They are a **different body from the 3D model**. Rotating the atlas and scrolling the CT show two different people, linked by the name of a structure rather than by shared geometry. The studies carry what real studies carry: contrast, noise, motion, and whatever anatomy that patient happened to have. Around half the voxels in a section are unlabelled, because a segmentation names organs rather than every plane of fat and connective tissue.

To rebuild them, run `python3 tools/fetch_subject.py <archive url> <subject> <destination>` and then `python3 tools/build_imaging.py`. The fetcher reads the remote archives over HTTP range requests, so pulling one subject transfers tens of megabytes rather than the 23.6 GB the CT archive weighs.

This is an educational explorer, not a diagnostic or surgical tool, and these studies are not a substitute for reading real ones.

## How it works

Geometry is merged into batches. Per-structure GPU textures control translation, visibility, and selection, while component geometry supports accurate picking. Exploded layouts pack only the visible pieces. Rendering updates when the scene changes; orbit controls remain responsive without thousands of separate draw calls.

The optional WebMCP tools expose anatomy search and inspection in compatible browsers. The visible interface works without them.

## Rebuilding geometry

The repository includes browser-ready geometry. Rebuilding it is optional: obtain the official BodyParts3D OBJ archive and English metadata tables, prepare the joined concepts and display-system mappings, run `scripts/convert-anatomy.py`, then `node scripts/optimize-anatomy.mjs` and `node scripts/compress-models.mjs`. Simplification uses a 0.2% relative error limit per structure.

## Deploy

Import this repository into Vercel as a Vite project. The included `vercel.json` configures `npm ci`, `npm run build`, and the `dist` output directory. It can also be served by a static host.

## License

Original application code is released under the [MIT License](LICENSE). The bundled data has its own terms, which travel with it:

- **BodyParts3D 4.0** anatomy meshes — CC BY 4.0.
- **TotalSegmentator** CT (subject s0287) — CC BY 4.0, © Wasserthal et al., University Hospital Basel.
- **TotalSegmentator MRI** (subjects s0175 and s0190) — **CC BY-NC-SA 2.0**, © Akinci D’Antonoli et al., University Hospital Basel.

> **The MRI licence is non-commercial and share-alike.** While that study is bundled, this build as a whole may not be used commercially, and derivatives must carry the same terms. The code remains MIT; the restriction comes from the data. Removing `public/imaging/mr-t1`, `public/imaging/mr-stir` and the MRI modality lifts it.

Preserve the attributions when redistributing. Third-party dependencies retain their respective licenses.

Issues and pull requests are welcome. Please include reproduction steps and browser/device details for interaction problems.
