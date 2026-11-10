"""Cut the hand-shadow 'beast' out of the cover: full silhouette + separate lower jaw (RGBA PNGs)."""
import json, sys, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
src, outdir = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert('L')).astype(np.float32)
N = im.shape[0]
bright = im > 120
# the ear has no visible rim on part of its outline: draw the missing boundary in by hand
barrier = Image.new('L', (N, N), 0)
d = ImageDraw.Draw(barrier)
ear = [(985, 665), (990, 620), (1005, 560), (1022, 500), (1036, 460), (1048, 440), (1065, 420), (1085, 400), (1106, 380),
       (1145, 362), (1192, 342), (1216, 340), (1262, 345), (1262, 362), (1245, 420), (1232, 480), (1223, 500), (1214, 520)]
d.line(ear, fill=255, width=7, joint='curve')
snout = [(105, 1168), (100, 1184), (93, 1220), (92, 1264), (120, 1296), (141, 1328), (148, 1344), (158, 1360), (174, 1376),
         (202, 1392), (245, 1408), (300, 1424)]
d.line(snout, fill=255, width=7, joint='curve')
bright |= np.asarray(barrier) > 0
IT = 4
rim = ndi.binary_dilation(bright, structure=np.ones((3, 3)), iterations=IT)
dark = (im < 100) & ~rim
lab, n = ndi.label(dark)
comp = lab == lab[1100, 1000]
ys, xs = np.where(comp)
print('core area', comp.sum(), 'bbox x', xs.min(), xs.max(), 'y', ys.min(), ys.max(), 'touches top', comp[0].any(), 'left', comp[:, 0].any())
# grow back to the true edge (only into darkish pixels, never across the drawn barrier)
grow_ok = (im < 128) & (np.asarray(barrier) == 0)
m = comp.copy()
for _ in range(IT + 2):
    m = ndi.binary_dilation(m, structure=np.ones((3, 3))) & grow_ok
# fill speckle holes but keep the eye (the big hole)
holes = ndi.binary_fill_holes(m) & ~m
hl, hn = ndi.label(holes)
hs = ndi.sum(np.ones_like(hl), hl, index=np.arange(1, hn + 1))
small = np.isin(hl, np.where(hs < 2500)[0] + 1)
m |= small
print('holes kept:', [int(s) for s in hs if s >= 2500])
# the rim light at the ear tip is dashed, which leaves notches in the outline: close them locally
# (computed on a larger, edge-padded window so the window border itself is not eroded)
oy0, oy1, ox0, ox1 = 260, 470, 1000, 1400
iy0, iy1, ix0, ix1 = 300, 430, 1040, 1360
r = 25
yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
disk = (xx * xx + yy * yy) <= r * r
sub = np.pad(m[oy0:oy1, ox0:ox1], r + 5, mode='edge')
closed = ndi.binary_closing(sub, structure=disk)[r + 5:-(r + 5), r + 5:-(r + 5)]
m[iy0:iy1, ix0:ix1] = closed[iy0 - oy0:iy1 - oy0, ix0 - ox0:ix1 - ox0]
# smooth the grainy (stippled) contour
m = ndi.gaussian_filter(m.astype(np.float32), 2.5) > 0.5
# anti-aliased alpha
alpha = ndi.gaussian_filter(m.astype(np.float32), 1.2)
alpha = np.clip((alpha - 0.5) * 2.2 + 0.5, 0, 1)
# lower jaw: below the mouth line, left of the joint
pivot = (1010.0, 1415.0)  # mouth corner, where the thumb (lower jaw) joins the palm
jp = Image.new('L', (N, N), 0)
ImageDraw.Draw(jp).polygon([pivot, (300, 1700), (300, N), (1060, N), (1060, 1560)], fill=255)
jaw = alpha * (np.asarray(jp) / 255.0)
head = alpha * (1 - np.asarray(jp) / 255.0)
def save(a, name):
    rgba = np.zeros((N, N, 4), np.uint8)
    rgba[..., 3] = (a * 255).astype(np.uint8)
    Image.fromarray(rgba).save(f'{outdir}/{name}')
save(alpha, 'beast_full.png'); save(head, 'beast_head.png'); save(jaw, 'beast_jaw.png')
json.dump({'size': N, 'jawPivot': pivot}, open(f'{outdir}/beast.json', 'w'))
vis = np.stack([im * 0.3] * 3, -1).astype(np.uint8)
vis[head > 0.5] = [210, 40, 30]; vis[jaw > 0.5] = [40, 120, 220]
Image.fromarray(vis).resize((1024, 1024)).save(f'{outdir}/beast_check.png')
