"""Composites the layer frames written by `lokey --demo <name> --record <dir>` over a backdrop and encodes a GIF.

usage: python scripts/art_layers.py <record dir> <backdrop.png> <out.gif> <width px> <fps>

Each layer (island, caption, dictation, lasso, glow) is a folder of PNGs captured on one shared clock (stamps.json).
Missing frames (the window was not open yet) are replaced by a transparent PNG of the layer's size. Standard library only.
"""
import json
import os
import struct
import subprocess
import sys
import zlib

rec, backdrop, out, width, fps = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
mp4 = sys.argv[6] if len(sys.argv) > 6 else None  # optional HD video next to the GIF
meta = json.load(open(os.path.join(rec, 'meta.json')))
stamps = json.load(open(os.path.join(rec, 'stamps.json')))
ORDER = ['glow', 'lasso', 'dictation', 'island', 'caption']


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    return struct.unpack('>II', head[16:24])


def blank_png(path, w, h):
    row = b'\x00' + b'\x00\x00\x00\x00' * w
    raw = zlib.compress(row * h, 9)

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', raw) + chunk(b'IEND', b''))


dur = '%.2f' % (stamps[-1] / 1000 + 0.2)
inputs = ['-loop', '1', '-t', dur, '-i', backdrop]  # the backdrop is a single image: loop it for exactly the length of the recording
filters = []
prev = '0'
n_in = 1
for name in ORDER:
    d = os.path.join(rec, name)
    frames = sorted(f for f in os.listdir(d) if f.endswith('.png')) if os.path.isdir(d) else []
    if not frames:
        continue
    w, h = png_size(os.path.join(d, frames[0]))
    blank = os.path.join(rec, f'blank-{name}.png')
    blank_png(blank, w, h)
    have = set(frames)
    lines = ['ffconcat version 1.0']
    for i, t in enumerate(stamps):
        dur = ((stamps[i + 1] if i + 1 < len(stamps) else t + 150) - t) / 1000
        f = f'{i:04d}.png'
        lines.append("file '%s'" % (os.path.join(d, f) if f in have else blank).replace('\\', '/'))
        lines.append('duration %.3f' % max(dur, 0.001))
    lines.append(lines[-2])
    lst = os.path.join(rec, f'{name}.txt')
    open(lst, 'w').write('\n'.join(lines))
    inputs += ['-f', 'concat', '-safe', '0', '-i', lst]
    pos = meta['layers'][name]
    filters.append(f'[{prev}][{n_in}]overlay={pos["x"]}:{pos["y"]}:eof_action=pass[v{n_in}]')
    prev = f'v{n_in}'
    n_in += 1

filters.append(f'[{prev}]fps={fps},scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle')
cmd = ['ffmpeg', '-v', 'error', '-y'] + inputs + ['-filter_complex', ';'.join(filters), '-loop', '0', out]
subprocess.run(cmd, check=True)
print('wrote', out)
if mp4:
    chain = ';'.join(filters[:-1]) + f';[{prev}]fps=30,scale=1280:-2:flags=lanczos,format=yuv420p[o]'
    subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inputs + ['-filter_complex', chain, '-map', '[o]', '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', mp4], check=True)
    print('wrote', mp4)
