// Reproducible launcher assets from the checked-in serif monogram outlines.
import sharp from 'sharp';
import {readFileSync,writeFileSync} from 'node:fs';
const icon=readFileSync('mobile/public/icon.svg'), foreground=readFileSync('mobile/public/icon-foreground.svg');
for(const [density,size,fg] of [['mdpi',48,108],['hdpi',72,162],['xhdpi',96,216],['xxhdpi',144,324],['xxxhdpi',192,432]]){
 const root='mobile/android/app/src/main/res/mipmap-'+density;
 await sharp(icon).resize(size,size).png().toFile(root+'/ic_launcher.png');
 await sharp(icon).resize(size,size).png().toFile(root+'/ic_launcher_round.png');
 await sharp(foreground).resize(fg,fg).png().toFile(root+'/ic_launcher_foreground.png');
}
writeFileSync('mobile/android/app/src/main/res/values/ic_launcher_background.xml','<?xml version="1.0" encoding="utf-8"?><resources><color name="ic_launcher_background">#f7f8f2</color></resources>');
await sharp(icon).resize(1024,1024).png().toFile('mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
await sharp(icon).resize(512,512).png().toFile('.data/mobile-icon-preview.png');
console.log('Tilted serif h launcher icons rendered.');
