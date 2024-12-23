#!/bin/bash

rm -rfv /data/nginx-pusher/data/js
cp -a /home/free-comments/data/nginx-pusher/data/js /data/nginx-pusher/data
rm -rfv /data/nginx-pusher/data/css
cp -a /home/free-comments/data/nginx-pusher/data/css /data/nginx-pusher/data
rm -rfv /data/nginx-pusher/data/images
cp -a /home/free-comments/data/nginx-pusher/data/images /data/nginx-pusher/data
rm -rfv /data/nginx-pusher/data/html
cp -a /home/free-comments/data/nginx-pusher/data/html /data/nginx-pusher/data
rm -rfv /data/nginx-pusher/data/manual
cp -a /home/free-comments/data/nginx-pusher/data/manual /data/nginx-pusher/data
rm -rfv /data/nginx-pusher/data/privacy
cp -a /home/free-comments/data/nginx-pusher/data/privacy /data/nginx-pusher/data

cp /home/free-comments/data/nginx-pusher/data/index.html /data/nginx-pusher/data
cp /home/free-comments/data/nginx-pusher/data/ufshm.html /data/nginx-pusher/data
cp /home/free-comments/data/nginx-pusher/data/protected-binary.html /data/nginx-pusher/data
cp /home/free-comments/data/nginx-pusher/data/public-binary.html /data/nginx-pusher/data
cp /home/free-comments/data/nginx-pusher/data/manifest.json /data/nginx-pusher/data
cp /home/free-comments/data/nginx-pusher/data/robots.txt /data/nginx-pusher/data
cp /home/free-comments/data/nginx-pusher/data/sitemap.xml /data/nginx-pusher/data

#rm -rfv /data/nginx-pusher/data/ufshm.html