"""Read a remote ZIP over HTTP range requests, so one subject can be pulled out of an archive that
is tens of gigabytes without downloading the whole thing. Zenodo serves ranges, and Python's zipfile
reads only the end-of-directory record, the central directory, and the members actually requested.

curl carries the transport because this machine's Python has no certificate bundle."""
import io, subprocess, sys, zipfile

class HttpFile(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos, self.fetched, self.requests = url, 0, 0, 0
        head = subprocess.run(['curl', '-sSIL', '--max-time', '120', url],
                              capture_output=True, text=True, check=True).stdout
        lengths = [line.split(':', 1)[1].strip() for line in head.splitlines()
                   if line.lower().startswith('content-length:')]
        if not lengths: raise RuntimeError(f'no content-length for {url}')
        self.length = int(lengths[-1])
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.length + offset
        return self.pos
    def readinto(self, buffer):
        want = min(len(buffer), self.length - self.pos)
        if want <= 0: return 0
        span = f'{self.pos}-{self.pos + want - 1}'
        for attempt in range(4):
            done = subprocess.run(['curl', '-sS', '--max-time', '900', '--retry', '2',
                                   '-r', span, self.url], capture_output=True)
            if done.returncode == 0 and done.stdout:
                break
            print(f'  retry {attempt + 1} for bytes {span}', file=sys.stderr)
        else:
            raise RuntimeError(f'range {span} failed')
        data = done.stdout
        view = memoryview(buffer).cast('B')
        view[:len(data)] = data
        self.pos += len(data); self.fetched += len(data); self.requests += 1
        return len(data)

def open_remote(url, buffer_size=1 << 22):
    backing = HttpFile(url)
    return zipfile.ZipFile(io.BufferedReader(backing, buffer_size=buffer_size)), backing
