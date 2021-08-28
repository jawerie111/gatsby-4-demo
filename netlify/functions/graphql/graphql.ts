import { join } from "path";
import os from "os";
import { existsSync, copySync, emptyDirSync } from "fs-extra";
import { link } from "linkfs";
import fs from "fs";
const cacheDir = join(process.cwd(), ".cache");
const tmpCache = join(os.tmpdir(), "gatsby", ".cache");

const rewrites = [cacheDir, tmpCache];
const lfs = link(fs, rewrites);
for (const key in lfs) {
  if (Object.hasOwnProperty.call(fs[key], "native")) {
    lfs[key].native = fs[key].native;
  }
}
global._fsWrapper = lfs;
emptyDirSync(tmpCache);
const includedDirs = ["data", "query-engine"];

includedDirs.forEach((dir) => {
  if (!existsSync(join(tmpCache, dir))) {
    copySync(join(cacheDir, dir), join(tmpCache, dir));
  }
});

const { GraphQLEngine } = require(process.cwd() + "/.cache/query-engine");
export async function handler(event, context) {
  const dbPath = join(tmpCache, "data", "datastore");

  const graphqlEngine = new GraphQLEngine({
    dbPath,
  });

  let query;
  const headers = {
    "Content-Type": "application/json",
  };

  if (event.body) {
    try {
      query = JSON.parse(event.body).query;
    } catch (e) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Invalid query",
        }),
        headers,
      };
    }
  } else if (event.queryStringParameters.query) {
    query = event.queryStringParameters.query;
  }

  if (!query) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "No query",
      }),
      headers,
    };
  }

  const result = await graphqlEngine.runQuery(query);

  return {
    statusCode: 200,
    body: JSON.stringify(result, null, 2),
    headers,
  };
}