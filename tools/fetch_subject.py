"""Pull one subject's volume and every segmentation mask out of a remote TotalSegmentator archive.
Members are read in archive order so the range reads stay sequential."""
import os, sys, time; sys.path.insert(0, os.path.dirname(__file__))
from remote_zip import open_remote

def fetch(url, subject, destination):
    zf, backing = open_remote(url)
    wanted = [n for n in zf.namelist() if n.startswith(subject + '/') and n.endswith('.nii.gz')]
    wanted.sort(key=lambda n: zf.getinfo(n).header_offset)
    os.makedirs(os.path.join(destination, subject, 'segmentations'), exist_ok=True)
    started, written = time.time(), 0
    for i, name in enumerate(wanted, 1):
        out = os.path.join(destination, name)
        if os.path.exists(out) and os.path.getsize(out) == zf.getinfo(name).file_size: continue
        with zf.open(name) as src, open(out, 'wb') as dst:
            data = src.read(); dst.write(data); written += len(data)
        if i % 20 == 0 or i == len(wanted):
            print(f'  {i}/{len(wanted)} members, {written/1e6:.1f} MB written, '
                  f'{backing.fetched/1e6:.0f} MB fetched, {time.time()-started:.0f}s', flush=True)
    return len(wanted), written, backing.fetched

if __name__ == '__main__':
    url, subject, destination = sys.argv[1], sys.argv[2], sys.argv[3]
    n, written, fetched = fetch(url, subject, destination)
    print(f'{subject}: {n} files, {written/1e6:.1f} MB written, {fetched/1e6:.0f} MB transferred')
