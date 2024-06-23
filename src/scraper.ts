import fetch from "node-fetch";
import cheerio from "cheerio";

export async function scrapeGoogleDoc(
  documentUrl: string
): Promise<string | null> {
  try {
    const response = await fetch(documentUrl);
    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);
      return $("body").text(); // Extracts text from the <body> tag, ignoring scripts, styles, etc.
    } else {
      console.error(`Failed to fetch document: HTTP status ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error(`Error occurred while fetching the document: ${error}`);
    return null;
  }
}

// Example usage
const documentUrl =
  "https://docs.google.com/document/d/1NiCEEUO2-38pIVGM7nrnpGRykbbtv2xuqLoKW50ZzLw/edit";
scrapeGoogleDoc(documentUrl).then((documentText) => {
  if (documentText) {
    console.log(documentText);
  } else {
    console.log("No document text was retrieved.");
  }
});
