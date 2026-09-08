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

| | Study | Subject | Coverage | Structures | Sampling | Download |
|---|---|---|---|---|---|---|
| CT | Body | s0287 | neck to feet, 125 cm | 101 | 306×835×246 at 1.5 mm | 51 MB |
| CT | Head | s0478 | head to upper chest, 36 cm | 53 | 181×237×167 at 1.5 mm | 7 MB |
| MRI | T1 | s0175 | head to thigh, 108 cm | 53 | 320×360×240 at 1.28×3.0×1.28 mm | 10 MB |
| MRI | T1 FS | s0187 | abdomen and pelvis, 45 cm | 44 | 260×320×146 at 1.41×1.41×1.5 mm | 9 MB |

Studies were chosen on measurements, not on their descriptions. Head candidates were fetched and
ranked on two numbers: noise, measured in the air outside the patient, and the steepness of the
soft-tissue-to-bone edge divided by that noise, so a grainy scan cannot pass itself off as a sharp
one. The one used measures 9 Hounsfield units of noise against 59 for the first one tried, with bone
edges five times steeper.

Resolution is capped at the 1.5 mm the collection distributes. Two higher-resolution head datasets
were looked at and neither can be used: [CADS BrainCT-1mm](https://huggingface.co/datasets/mrmrx/CADS-dataset)
is gated behind an access request, and [HaN-Seg](https://zenodo.org/records/7442914), 42 patients
with 30 organs at risk, is CC BY-NC-ND, whose no-derivatives clause forbids the resampling and
reformatting this viewer does. Full-resolution source images exist on TCIA but are published without
segmentations, which would cost the naming this atlas is built around.
| MRI | T2 | s0173 | abdomen, 40 cm | 39 | 384×384×32 at 1.04×1.04×6.0 mm | 4 MB |
| MRI | STIR | s0190 | chest to pelvis, 50 cm | 34 | 384×384×39 at 1.3×1.3×6.0 mm | 3 MB |

CT from [TotalSegmentator](https://doi.org/10.5281/zenodo.10047292), CC BY 4.0. MRI from [TotalSegmentator MRI](https://doi.org/10.5281/zenodo.11367005), **CC BY-NC-SA 2.0**.

**No single clinical study covers a whole body.** CT and MRI are acquired per body region, and no study type in either collection combines the head with the trunk or the legs; even a protocol called whole body stops at the thighs. So the body arrives in two CT studies of two patients that overlap at the shoulders: one running from the neck to the feet, one carrying the head, brain and cervical spine. The only genuinely head-to-toe public imaging is the Visible Human Project, a cadaver with no segmentations, where naming a structure would stop working.

The CT keeps the 1.5 mm sampling the collection distributes, which is as fine as this source goes: the original acquisitions are published only without their segmentations. That costs 51 MB on first opening the body study and around 190 MB of held memory. Building at 2 mm halves both: pass `target_spacing=(2.0, 2.0, 2.0)` in `tools/build_imaging.py`.

An MR sequence is a study too, not a display setting. One acquisition carries one weighting, so T1, T2 and STIR are three separate studies of three patients. Each is labelled with the weighting **measured from its own tissue signals** rather than read from metadata this collection records in mixed units: urine against liver, spleen against liver, and subcutaneous fat against liver, the last being what separates a STIR from a T2 since muscle is dark on both. `tools/weighting.py` does the measuring, and documents its own limit: those ratios compare one region against another, so they hold only within a single station and cannot classify a stitched whole-body acquisition.

**Structures are named as a report would name them.** The source classes are short identifiers
meant for a model's output directory: `autochthon_left` is the deep intrinsic back muscle group, and
calling it "Left autochthon" on an image teaches the wrong word. Every class carries the reported
name and its Terminologia Anatomica term, so `autochthon_left` reads as Left erector spinae,
*Musculi dorsi proprii sinistri*, and `vertebrae_C1` as Atlas (C1). The names are written onto the
image itself for the larger structures, largest first, with anything that would collide left to the
readout instead; the panel lists everything the slice holds, in full, however small. Each name is
anchored to the point nearest the structure's centre of area that actually lies inside it, so a
label on a horseshoe-shaped colon points at the colon rather than into the bowel it wraps around.
One control turns the written names off, leaving the image clean; hovering then tints whatever lies
under the pointer and names just that one, which is the way to read a section without a wall of text
over it. See `tools/anatomy_names.py`.

**Each magnetic resonance study carries the window it should be read at.** There is no absolute
scale to window against, and reading a study across its whole stored range leaves it dark, because
the bright tail of fat, fluid and vessels takes up most of that range: the STIR sat at 27% grey
that way. Centring the window on the median of the body puts tissue at mid grey. Centring on the
midpoint of the range instead is worse than doing nothing, because the distribution is skewed.

**Reformats are only as good as the acquisition.** A T2 or a STIR of the abdomen is conventionally
acquired as thick two-dimensional slices, six millimetres here, so a sagittal or axial reformat of
one is coarse however it is displayed and no windowing changes that. Only one study in the whole
collection is near-isotropic, the fat-suppressed T1, and it is included for exactly that reason:
it stays sharp reformatted into any plane. The collection holds no near-isotropic T2 or STIR of the
trunk, and the only trunk STIR at all is the six-millimetre one here.

**Whole-body magnetic resonance is levelled across its stations.** It is acquired in overlapping
stations, each scaled on its own, so the joins show as horizontal bands: in the T1 the head station
ran about three times brighter than the trunk and a quarter of the head was clipped to white. The
joins are found rather than assumed, as slices where the body median jumps while the amount of body
barely changes, and each station is then scaled as a block. Three joins were found in the T1; the
single-station T2 and STIR need none and are left untouched. Head-to-trunk brightness falls from
2.93 to 1.59 and clipping in the head from 24% to 5%.

Two things this deliberately does not do. It never touches CT, whose Hounsfield numbers are absolute
and are what the window presets act on. And it scales whole stations rather than individual slices:
scaling per slice would flatten the real craniocaudal variation, and smoothing a gain curve across a
step leaves half the step behind. N4 bias field correction was tried and made the seams worse, since
it fits a smooth field and cannot represent a discontinuity; the faint rectangles still visible where
one station's field of view ends are what remains, and they come with the source.

**The published labels are cleaned on the way in.** A segmentation model run over a region it was not expecting leaves false positives, and this collection's own labels put nine millimetres of skull among the toes of a study whose highest slice is lung. Two filters remove them: connected components far smaller than the structure they belong to, and structures that sit somewhere they anatomically cannot, such as a skull below a lung. Anatomy legitimately cut off by the edge of the field, like a clavicle at the top of a scan that stops at the neck, is kept.

These are clinical studies, so they carry incidental findings. The STIR has a visible lesion in the left axilla. They show real anatomy, not idealised anatomy.

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
- **TotalSegmentator** CT (subjects s0287 and s0478) — CC BY 4.0, © Wasserthal et al., University Hospital Basel.
- **TotalSegmentator MRI** (subjects s0175, s0187, s0173 and s0190) — **CC BY-NC-SA 2.0**, © Akinci D’Antonoli et al., University Hospital Basel.

> **The MRI licence is non-commercial and share-alike.** While that study is bundled, this build as a whole may not be used commercially, and derivatives must carry the same terms. The code remains MIT; the restriction comes from the data. Removing the `public/imaging/mr-*` studies and the MRI modality lifts it.

Preserve the attributions when redistributing. Third-party dependencies retain their respective licenses.

Issues and pull requests are welcome. Please include reproduction steps and browser/device details for interaction problems.
