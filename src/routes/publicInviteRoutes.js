import express from "express";
const router = express.Router();

router.get("/invite/:token", (req, res) => {
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  const isAndroid = ua.includes("android");
  const isIOS = /iphone|ipad|ipod/.test(ua);

  const pkg = process.env.ANDROID_PACKAGE;         // e.g., com.jambubble.app
  const appId = process.env.APP_STORE_ID;          // e.g., 1234567890

  const playWeb = `https://play.google.com/store/apps/details?id=${pkg}`;
  const playIntent =`https://play.google.com/store/apps/details?id=${pkg}`;
  const iosItms = `itms-apps://itunes.apple.com/app/id${appId}`;

  if (isAndroid) return res.redirect(302, playIntent);
  if (isIOS) return res.redirect(302, iosItms);
  return res.redirect(302, playWeb); // desktop/unknown
});

export default router;
