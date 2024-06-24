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
    Title: row["Title"] as string, // Updated to match the new header
    URL: row["Url"] as string, // Updated to match the new header
    Text: row["TextContent"] as string, // Updated to match the new header
  }));

  // Debugging: Log the documents array
  console.log("Documents:", documents);

  // Validate that the Text field is not null, undefined, or empty after trimming whitespace
  const validDocuments = documents.filter((doc) => doc.Text && doc.Text.trim());

  // Debugging: Log the validDocuments array
  console.log("Valid Documents:", validDocuments);

  if (validDocuments.length === 0) {
    throw new Error("No valid documents found with non-null text.");
  }

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
  progressBar.start(validDocuments.length, 0);

  // Start the batch embedding process with an increased batch size
  await embedder.init();
  await embedder.embedBatch(
    validDocuments.map((doc) => doc.Text),
    50, // Increased batch size
    async (embeddings) => {
      counter += embeddings.length;
      console.log(embeddings.length);
      // Whenever the batch embedding process returns a batch of embeddings, insert them into the index
      await index.upsert(
        embeddings.map((embedding, i) => ({
          id: (counter - embeddings.length + i).toString(), // Ensure unique IDs
          values: embedding.values, // Access the correct property for the vector
          metadata: {
            Title: validDocuments[counter - embeddings.length + i].Title,
            URL: validDocuments[counter - embeddings.length + i].URL,
            text: validDocuments[counter - embeddings.length + i].Text,
          },
        }))
      );
      progressBar.update(counter);
    }
  );

  progressBar.stop();
  console.log(
    `Inserted ${validDocuments.length} documents into index ${indexName}`
  );
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
