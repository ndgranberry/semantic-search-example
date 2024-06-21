import puppeteer from "puppeteer";

export async function scrapeGoogleDoc(url: string): Promise<string> {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2" });

  // Assuming the text is within the body of the document
  const text = await page.evaluate(() => document.body.innerText);

  await browser.close();
  return text;
}

// Get URL from command line arguments
const url = process.argv[2]; // The first argument is the node executable, the second is the script file name, and the third is our first actual argument

if (!url) {
  console.error("Please provide a URL as an argument");
  process.exit(1);
}

scrapeGoogleDoc(url).then((text) => console.log(text));
