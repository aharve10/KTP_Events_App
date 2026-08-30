Chapter photos live here.

USED BY TWO THINGS
------------------
1. The Home hero band. List the files in js/config.js -> HERO_IMAGES.
   One is picked at random each time someone opens the app.

2. Per-event photos. Officers paste a URL when creating an event; a file in
   this folder is referenced as  assets/photos/your-file.jpg

WHY PUT THEM HERE RATHER THAN LINKING
-------------------------------------
Files in this folder ship with the site, so they work forever and load fast.
Google Photos and Google Drive share links usually stop working within a few
months once the sharing settings roll over, and the photo silently disappears
from the app.

WHAT TO PUT IN
--------------
- Landscape crops. The hero band is 3:1 and event photos are 16:9; both
  centre-crop, so anything tall gets its top and bottom cut off.
- Resize to about 1600px wide before adding them. Straight-off-the-phone
  photos are 4-8 MB each, which is slow on campus wifi and pointless at this
  display size.
- .jpg for photos, .png only if you need transparency.
- Lowercase filenames with dashes, no spaces:  ski-trip.jpg  not  Ski Trip.JPG

The app currently expects these two, per js/config.js -> HERO_IMAGES:
    beak-n-skiff.jpg   1600x853   (crops to 63% of its height in the 3:1 band)
    ski-trip.jpg       1600x1200  (crops to 44% of its height in the 3:1 band)
If a listed file is missing, the hero band removes itself and Home simply starts
at the status strips. Nothing breaks.

A NOTE ON CROPPING
------------------
The band is 3:1 and crops equally from top and bottom. The closer a photo is to
3:1 already, the less you lose. A 4:3 photo straight off a phone keeps only its
middle 44%, so anyone standing near the top or bottom of the frame gets cut off.
If a photo looks decapitated, crop it to roughly 3:1 before adding it.

CASE SENSITIVITY
----------------
Windows doesn't care about capitals but Netlify and GitHub Pages do. A file
called Ski-Trip.jpg listed in config as ski-trip.jpg works on your laptop and
404s on the live site. Keep everything lowercase.
