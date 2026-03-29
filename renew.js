const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const TARGET = "https://game4free.net/game";

const EXT_BUSTER = path.resolve(__dirname, "extensions/buster/unpacked");
const SCREEN = path.resolve(__dirname, "screenshots");

const MAX_RUN_RETRY = 3;
const MAX_BUSTER_TRY = 5;

function sleep(ms){
  return new Promise(r=>setTimeout(r,ms));
}

function ensureDir(){
  if(!fs.existsSync(SCREEN)){
    fs.mkdirSync(SCREEN,{recursive:true});
  }
}

async function snap(page,name){
  try{
    const file = path.join(SCREEN,`${Date.now()}_${name}.png`);
    await page.screenshot({path:file,fullPage:true});
    console.log("📸",file);
  }catch{}
}

/* =======================
用户名生成
======================= */

function rand(arr){
  return arr[Math.floor(Math.random()*arr.length)];
}

function genUsername(){

  const a = [
    "Shadow","Nova","Blaze","Frost","Storm",
    "Pixel","Ghost","Lunar","Turbo","Solar"
  ];

  const b = [
    "Wolf","Dragon","Knight","Craft",
    "Hunter","Rider","Miner","Player"
  ];

  const num = Math.floor(Math.random()*900+100);

  const styles = [
    `${rand(a)}${rand(b)}`,
    `${rand(a)}${rand(b)}${num}`,
    `${rand(a)}${num}`
  ];

  return rand(styles);
}

/* =======================
等待扩展
======================= */

async function waitExtension(context){

  for(let i=0;i<60;i++){

    if(context.serviceWorkers().length ||
       context.backgroundPages().length){

      console.log("✅ Buster loaded");
      return true;
    }

    await sleep(500);
  }

  return false;
}

/* =======================
CAPTCHA
======================= */

async function clickCheckbox(page){

  const iframe = await page.waitForSelector(
    'iframe[src*="anchor"]',
    {timeout:120000}
  );

  const frame = await iframe.contentFrame();

  const box = await frame.waitForSelector("#recaptcha-anchor");

  await box.click({force:true});

  await sleep(2000);
}

async function waitChallenge(page){

  try{

    const iframe = await page.waitForSelector(
      'iframe[src*="bframe"]',
      {timeout:10000}
    );

    return await iframe.contentFrame();

  }catch{

    return null;
  }
}

/* =======================
点击 Buster
======================= */

async function clickBuster(page,frame){

  const reload = frame.locator("#recaptcha-reload-button");
  const audio = frame.locator("#recaptcha-audio-button");

  await reload.waitFor();
  await audio.waitFor();

  const r = await reload.boundingBox();
  const a = await audio.boundingBox();

  if(!r || !a) throw new Error("button pos fail");

  const dx = a.x - r.x;
  const dy = a.y - r.y;

  const x = a.x + dx;
  const y = a.y + dy;

  console.log("🤖 click solver");

  await page.mouse.click(x,y);

  await sleep(6000);
}

/* =======================
检测 captcha
======================= */

async function waitSolved(page,timeout=30000){

  const start = Date.now();

  while(Date.now()-start < timeout){

    for(const f of page.frames()){

      try{

        const token = await f.evaluate(()=>{
          return document.querySelector(
            "textarea[name='g-recaptcha-response']"
          )?.value;
        });

        if(token && token.length>30){

          console.log("✅ captcha solved");
          return true;
        }

      }catch{}
    }

    await sleep(2000);
  }

  throw new Error("captcha timeout");
}

/* =======================
解验证码
======================= */

async function solveCaptcha(page,frame){

  for(let i=1;i<=MAX_BUSTER_TRY;i++){

    console.log("🔁 Buster try",i);

    await clickBuster(page,frame);

    try{

      await waitSolved(page,15000);

      return true;

    }catch{

      console.log("⚠️ try failed");

    }
  }

  throw new Error("captcha timeout");
}

/* =======================
运行一次
======================= */

async function runOnce(){

  ensureDir();

  const profile = fs.mkdtempSync(path.join(os.tmpdir(),"pw-"));

  const context = await chromium.launchPersistentContext(profile,{

    headless:false,

    args:[
      `--disable-extensions-except=${EXT_BUSTER}`,
      `--load-extension=${EXT_BUSTER}`,
      "--no-sandbox"
    ]

  });

  if(!(await waitExtension(context))){
    throw new Error("buster not loaded");
  }

  const page = await context.newPage();

  const username = genUsername();

  console.log("🎮 username:",username);

  await page.goto(TARGET,{waitUntil:"networkidle"});

  await snap(page,"open");

  /* 输入用户名 */

  await page.fill("#username-input",username);

  console.log("✏️ username filled");

  /* captcha */

  await clickCheckbox(page);

  const frame = await waitChallenge(page);

  if(frame){

    console.log("🧩 challenge detected");

    await solveCaptcha(page,frame);

  }else{

    console.log("✅ captcha skipped");
  }

  await snap(page,"captcha_ok");

  /* 解除 disabled */

  await page.evaluate(()=>{

    const btn = document.querySelector("#submit-button");

    if(btn) btn.removeAttribute("disabled");

  });

  /* 提交 */

  console.log("🚀 submit");

  await page.click("#submit-button",{force:true});

  await page.waitForTimeout(8000);

  await snap(page,"done");

  console.log("🎉 finished");

  await context.close();
}

/* =======================
入口
======================= */

(async()=>{

  for(let i=1;i<=MAX_RUN_RETRY;i++){

    console.log("\n===== RUN",i,"=====");

    try{

      await runOnce();

      process.exit(0);

    }catch(e){

      console.log("❌",e.message);

    }

    await sleep(5000);
  }

  process.exit(1);

})();
