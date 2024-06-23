import cliProgress from "cli-progress";
import { config } from "dotenv";
import loadCSVFile from "./csvLoader.js";

import { embedder } from "./embeddings.js";
import {
  Pinecone,
  type ServerlessSpecCloudEnum,
} from "@pinecone-database/pinecone";
import { getEnv, validateEnvironmentVariables } from "./utils/util.js";
import { scrapeGoogleDoc } from "./scraper.js";

import type { TextMetadata } from "./types.js";

// Load environment variables from .env
config();

const progressBar = new cliProgress.SingleBar(
  {},
  cliProgress.Presets.shades_classic
);

let counter = 0;

export const load = async (csvPath: string) => {
  validateEnvironmentVariables();

  // Get a Pinecone instance
  const pinecone = new Pinecone();

  // Load the CSV file
  const { data } = await loadCSVFile(csvPath);

  // Map the CSV data to the desired structure
  const documents = data.map((row) => ({
    Title: row["A"] as string, // Assuming 'A' is the header for the title column
    URL: row["B"] as string, // Assuming 'B' is the header for the URL column
    Text: row["C"] as string, // Assuming 'C' is the header for the text column
  }));

  // Get index name, cloud, and region
  const indexName = getEnv("PINECONE_INDEX");
  const indexCloud = getEnv("PINECONE_CLOUD") as ServerlessSpecCloudEnum;
  const indexRegion = getEnv("PINECONE_REGION");

  // Create a Pinecone index with a dimension of 384 to hold the outputs
  // of our embeddings model. Use suppressConflicts in case the index already exists.
  await pinecone.createIndex({
    name: indexName,
    dimension: 384,
    spec: {
      serverless: {
        region: indexRegion,
        cloud: indexCloud,
      },
    },
    waitUntilReady: true,
    suppressConflicts: true,
  });

  // Select the target Pinecone index. Passing the TextMetadata generic type parameter
  const index = pinecone.index<TextMetadata>(indexName);

  // Start the progress bar
  progressBar.start(documents.length, 0);

  // Start the batch embedding process
  await embedder.init();
  await embedder.embedBatch(
    documents.map((doc) => doc.Text),
    5,
    async (embeddings) => {
      counter += embeddings.length;
      console.log(embeddings.length);
      // Whenever the batch embedding process returns a batch of embeddings, insert them into the index
      await index.upsert(
        embeddings.map((embedding, i) => ({
          id: i.toString(),
          values: embedding, // Change 'vector' to 'values' to match the expected type
          metadata: { Title: documents[i].Title, URL: documents[i].URL },
        }))
      );
      progressBar.update(counter);
    }
  );

  progressBar.stop();
  console.log(`Inserted ${documents.length} documents into index ${indexName}`);
};

export const loadFromUrl = async (url: string) => {
  validateEnvironmentVariables();
  const text = await scrapeGoogleDoc(url);
  const pinecone = new Pinecone();

  // Initialize the embedder and create embeddings
  await embedder.init();
  if (text === null) {
    throw new Error("Failed to retrieve text from URL: " + url);
  }
  const embedding = await embedder.embed(text);

  // Get Pinecone index details
  const indexName = getEnv("PINECONE_INDEX");
  const index = pinecone.index<TextMetadata>(indexName);

  // Insert the embedding into the Pinecone index
  await index.upsert([embedding]);
  console.log(`Inserted document from ${url} into index ${indexName}`);
};
