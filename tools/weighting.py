"""Work out what a study is weighted for from the image rather than from its metadata, whose
repetition and echo times are recorded in mixed units across this collection.

Urine in the bladder is nearly free water and liver is not, so their signal ratio separates the two
weightings cleanly: on T1 urine is dark against liver, on T2 it is much brighter. Fat against
muscle confirms it, and a study where fat is dark while fluid is bright has had its fat suppressed."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import nifti

def signal(subject_dir, name, volume):
    path = os.path.join(subject_dir, 'segmentations', f'{name}.nii.gz')
    if not os.path.exists(path): return None
    mask = nifti.read(path)['data'] > 0
    if mask.sum() < 200: return None
    return float(np.median(volume[mask]))

def classify(subject_dir, modality_file='mri.nii.gz'):
    raw = nifti.read(os.path.join(subject_dir, modality_file))
    volume = raw['data'].astype(np.float32) * raw['slope'] + raw['inter']
    parts = {n: signal(subject_dir, n, volume) for n in
             ('urinary_bladder', 'liver', 'spleen', 'kidney_left', 'kidney_right',
              'autochthon_left', 'autochthon_right', 'subcutaneous_fat', 'spinal_cord')}
    fluid, liver = parts['urinary_bladder'], parts['liver']
    muscle = next((parts[k] for k in ('autochthon_left', 'autochthon_right') if parts[k]), None)
    fat = parts['subcutaneous_fat']
    verdict, ratio = 'unclear', None
    if fluid and liver:
        ratio = fluid / liver
        verdict = 'T2' if ratio > 1.6 else 'T1' if ratio < 0.9 else 'intermediate'
    if verdict == 'T2' and fat and muscle and fat < muscle * 1.2:
        verdict = 'T2 fat-suppressed'
    return {'verdict': verdict, 'fluid/liver': None if ratio is None else round(ratio, 2),
            'signals': {k: None if v is None else round(v) for k, v in parts.items()}}

if __name__ == '__main__':
    for directory in sys.argv[1:]:
        result = classify(directory)
        print(f"{os.path.basename(directory):8s} {result['verdict']:20s} "
              f"fluid/liver={result['fluid/liver']}  {result['signals']}")
