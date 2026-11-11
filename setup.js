// إعداد مشروع فايربيس للكتالوج — بيتشغّل مرة واحدة على اللابتوب: node setup.js
const { execSync } = require("child_process");
const fs = require("fs");
const PROJECT = (JSON.parse(fs.readFileSync(".firebaserc", "utf8")).projects || {}).default;
const run = (cmd, opts = {}) => { console.log("\n> " + cmd); return execSync(cmd, { stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8" }); };
const json = cmd => JSON.parse(run(cmd + " --json", { capture: true }));
const tryRun = cmd => { try { return run(cmd); } catch (e) { console.log("   (تخطي: " + (e.message || "").split("\n")[0] + ")"); } };

(async () => {
  console.log("المشروع: " + PROJECT);
  const projects = json("firebase projects:list").result || [];
  if (!projects.some(p => p.projectId === PROJECT)) {
    run(`firebase projects:create ${PROJECT} --display-name "Housewares Catalog"`);
  } else console.log("المشروع موجود بالفعل");

  tryRun(`firebase firestore:databases:create "(default)" --location europe-west1 --project ${PROJECT}`);

  let apps = json(`firebase apps:list WEB --project ${PROJECT}`).result || [];
  let appId = apps[0] && apps[0].appId;
  if (!appId) appId = json(`firebase apps:create WEB catalog --project ${PROJECT}`).result.appId;
  const sdk = json(`firebase apps:sdkconfig WEB ${appId} --project ${PROJECT}`).result;
  const cfg = sdk.sdkConfig || JSON.parse((sdk.fileContents.match(/\{[\s\S]*\}/) || ["{}"])[0]);
  fs.writeFileSync("firebase-config.js", "window.FIREBASE_CONFIG = " + JSON.stringify(cfg) + ";\n");
  console.log("اتكتب firebase-config.js");

  run(`firebase deploy --only firestore:rules,hosting --project ${PROJECT} --non-interactive`);
  console.log("\nالموقع: https://" + PROJECT + ".web.app");
  console.log("\nفاضل خطوتين:");
  console.log("1) فعّل الدخول بجوجل: https://console.firebase.google.com/project/" + PROJECT + "/authentication/providers");
  console.log("2) اربط النشر التلقائي من جيت هب: firebase init hosting:github");
})().catch(e => { console.error("\nحصل خطأ:", e.message); process.exit(1); });
