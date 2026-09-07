"""Measure the craniocaudal extent of every subject in a remote archive, by reading only each
volume's NIfTI header. Answers what the widest available study actually is rather than guessing."""
import csv, gzip, io, json, os, struct, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from remote_zip import open_remote

url, member, out = sys.argv[1], sys.argv[2], sys.argv[3]
zf, backing = open_remote(url, buffer_size=1 << 22)
rows = list(csv.DictReader(io.StringIO(zf.read('meta.csv').decode('utf-8-sig')), delimiter=';'))
key = list(rows[0])[0]
results, started = [], time.time()
for i, row in enumerate(rows, 1):
    subject = row[key]
    try:
        with zf.open(f'{subject}/{member}') as raw:
            with gzip.GzipFile(fileobj=io.BytesIO(raw.read(140000))) as g: head = g.read(348)
        end = '<' if struct.unpack('<i', head[:4])[0] == 348 else '>'
        dim = struct.unpack(end + '8h', head[40:56])[1:4]
        pix = struct.unpack(end + '8f', head[76:108])[1:4]
        srow = [struct.unpack(end + '4f', head[280 + 16 * k: 296 + 16 * k]) for k in range(3)]
        axis = max(range(3), key=lambda a: abs(srow[2][a]))          # whichever axis runs superiorly
        results.append({'subject': subject, 'cc_cm': round(dim[axis] * pix[axis] / 10, 1),
                        'dims': list(dim), 'spacing': [round(p, 2) for p in pix],
                        'study': row.get('study_type', ''), 'pathology': row.get('pathology', '')})
    except Exception as e:
        results.append({'subject': subject, 'cc_cm': None, 'error': str(e)[:60]})
    if i % 50 == 0:
        print(f'  {i}/{len(rows)}, {backing.fetched/1e6:.0f} MB, {time.time()-started:.0f}s', flush=True)
        json.dump(results, open(out, 'w'))
json.dump(results, open(out, 'w'))
good = [r for r in results if r.get('cc_cm')]
good.sort(key=lambda r: -r['cc_cm'])
print(f'done: {len(good)} measured, widest {good[0]["cc_cm"]} cm ({good[0]["subject"]})')
for r in good[:12]:
    print(f'  {r["cc_cm"]:6.1f} cm  {r["subject"]}  {str(r["dims"]):18s} {r["study"]}  [{r["pathology"]}]')
