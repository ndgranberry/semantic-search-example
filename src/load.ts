import cliProgress from "cli-progress";
import { config } from "dotenv";
import loadCSVFile from "./csvLoader.js";

import { embedder } from "./embeddings.js";
import {
  Pinecone,
  type ServerlessSpecCloudEnum,
} from "@pinecone-database/pinecone";
import { getEnv, validateEnvironmentVariables } from "./utils/util.js";
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

  // Create a readable stream from the CSV file
  const { data, meta } = await loadCSVFile(csvPath);

  // Extract the selected columns from the CSV file
  const documents = data.map((row) => ({
    Title: row["Title"] as string,
    URL: row["URL"] as string,
    Text: row["TextContent"] as string,
    Summary: row["Summary"] as string,
  }));

  const validDocuments = documents.filter((doc) => doc.Text && doc.Text.trim());

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

  // Start the batch embedding process
  await embedder.init();
  await embedder.embedBatch(
    validDocuments.map((doc) => doc.Text),
    50,
    async (embeddings) => {
      counter += embeddings.length;

      // Prepare the embeddings with metadata
      const embeddingsWithMetadata = embeddings.map((embedding, i) => ({
        id: (counter - embeddings.length + i).toString(),
        values: embedding.values,
        metadata: {
          Title: validDocuments[counter - embeddings.length + i].Title,
          URL: validDocuments[counter - embeddings.length + i].URL,
          text: validDocuments[counter - embeddings.length + i].Text, // Change Text to text
          Summary: validDocuments[counter - embeddings.length + i].Summary, // Ensure Summary is included
        },
      }));

      // Log the embeddings and their corresponding metadata (including Summary)
      console.log(
        "Embeddings and Metadata:",
        embeddingsWithMetadata.map((e) => ({
          id: e.id,
          metadata: {
            Title: e.metadata.Title,
            URL: e.metadata.URL,
            text: e.metadata.text,
            Summary: e.metadata.Summary, // Log Summary
          },
        }))
      );

      // Whenever the batch embedding process returns a batch of embeddings, insert them into the index
      await index.upsert(embeddingsWithMetadata);
      progressBar.update(counter);
    }
  );

  progressBar.stop();
  console.log(
    `Inserted ${validDocuments.length} documents into index ${indexName}`
  );
};
