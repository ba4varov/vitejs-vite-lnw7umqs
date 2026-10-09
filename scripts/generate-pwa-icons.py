"""Reproducible sun/cloud mark matching the existing 🌤️ title and blue palette.
Run with Pillow; generates only public PWA icons, never edits existing artwork.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import math
target = Path(__file__).resolve().parents[1] / 'public/pwa'
target.mkdir(parents=True, exist_ok=True)
for name, size in [('icon-192', 192), ('icon-512', 512), ('maskable-512', 512), ('apple-touch-icon', 180)]:
    scale = 4
    image = Image.new('RGB', (size*scale, size*scale), '#2563eb')
    d = ImageDraw.Draw(image)
    def box(coords): return tuple(round(x*size*scale) for x in coords)
    for i in range(8):
        a = i*math.pi/4
        d.line(box((.43+.19*math.cos(a), .40+.19*math.sin(a), .43+.24*math.cos(a), .40+.24*math.sin(a))), fill='#fbbf24', width=round(size*scale*.035))
    d.ellipse(box((.28,.25,.58,.55)), fill='#fbbf24')
    for b in [(.26,.46,.54,.71),(.41,.37,.73,.71),(.58,.49,.81,.72)]:
        d.ellipse(box(b), fill='#ffffff')
    d.rounded_rectangle(box((.28,.57,.79,.73)), radius=round(size*scale*.07), fill='#ffffff')
    image.resize((size,size),Image.Resampling.LANCZOS).save(target / (name+'.png'))
image = Image.new('RGBA', (384,384))
d=ImageDraw.Draw(image)
d.ellipse((85,150,210,280),fill='white');d.ellipse((145,105,290,280),fill='white');d.ellipse((240,180,330,280),fill='white')
d.rounded_rectangle((90,220,325,290),radius=25,fill='white')
image.resize((96,96),Image.Resampling.LANCZOS).save(target/'badge-96.png')
