// @ts-check

const pathToRegexp = require("path-to-regexp");
const bodyParser = require("co-body");
const multer = require("multer");
const parseForm = multer().any();
const path = require("path");
const { existsSync } = require("fs");
const { proxyRequest } = require("./functions");

module.exports = async (req, res, event) => {
  // Multipart form data middleware. because co-body can't handle it

  await new Promise((next) => parseForm(req, res, next));
  try {
    // If req.body is populated then it was multipart data
    if (
      !req.files &&
      !req.body &&
      req.method !== "GET" &&
      req.method !== "HEAD"
    ) {
      req.body = await bodyParser(req);
    }
  } catch (e) {
    console.log("Error parsing body", e, req);
  }

  let pathFragment = decodeURIComponent(req.url);

  let functions;
  try {
    // @ts-ignore This is generated in the user's site
    functions = require("../../../.cache/functions/manifest.json"); // eslint-disable-line node/no-missing-require, node/no-unpublished-require
  } catch (e) {
    return {
      statusCode: 404,
      body: "Could not load function manifest",
    };
  }

  const ssrRoutes = new Map();

  functions.forEach((fn) => {
    if (
      fn.functionRoute.startsWith(`_ssr/`) &&
      !fn.functionRoute.startsWith(`_ssr/page-data/`)
    ) {
      /** @type string | RegExp */
      let pathName = fn.functionRoute;

      /** @type string | RegExp */
      let pageDataRoute = fn.functionRoute.replace(`_ssr/`, `_ssr/page-data/`);
      const keys = [];
      if (fn.matchPath) {
        pathName = pathToRegexp(fn.matchPath, keys);
        pageDataRoute = pathToRegexp(
          fn.matchPath.replace(`_ssr/`, `_ssr/page-data/`) + `/page-data.json`,
          []
        );
      }

      ssrRoutes.set(pathName, {
        apiRoute: `/api/${fn.functionRoute}`,
        params: keys.map((key) => key.name),
      });
      ssrRoutes.set(pageDataRoute, {
        apiRoute: `/api/${fn.functionRoute.replace(`_ssr`, `_ssr/page-data`)}`,
        params: keys.map((key) => key.name),
      });
    }
  });

  // Find the matching function, given a path. Based on Gatsby Functions dev server implementation
  // https://github.com/gatsbyjs/gatsby/blob/master/packages/gatsby/src/internal-plugins/functions/gatsby-node.ts

  for (const [ssrPath, ssrFn] of ssrRoutes) {
    const match = `_ssr${pathFragment}`.match(ssrPath);
    if (match) {
      console.log("match ssr");
      let url = ssrFn.apiRoute;
      ssrFn.params.forEach((param, index) => {
        url = url.replace(`[${param}]`, match[index + 1]);
      });

      pathFragment = url;
      res.setHeader("content-type", "text/html");
      break;
    }
  }

  pathFragment = pathFragment.replace("/api/", "");

  // Check first for exact matches.
  let functionObj = functions.find(
    ({ functionRoute }) => functionRoute === pathFragment
  );

  if (!functionObj) {
    // Check if there's any matchPaths that match.
    // We loop until we find the first match.

    functions.some((f) => {
      let exp;
      const keys = [];
      if (f.matchPath) {
        exp = pathToRegexp(f.matchPath, keys);
      }
      if (exp && exp.exec(pathFragment) !== null) {
        functionObj = f;
        const matches = [...pathFragment.match(exp)].slice(1);
        const newParams = {};
        matches.forEach(
          (match, index) => (newParams[keys[index].name] = match)
        );
        req.params = newParams;

        return true;
      } else {
        return false;
      }
    });
  }

  if (functionObj) {
    console.log(`Running ${functionObj.functionRoute}`);
    const start = Date.now();

    const pathToFunction = process.env.NETLIFY_DEV
      ? functionObj.absoluteCompiledFilePath
      : path.join(
          __dirname,
          "..",
          "..",
          "..",
          ".cache",
          "functions",
          functionObj.relativeCompiledFilePath
        );

    if (process.env.NETLIFY_DEV && !existsSync(pathToFunction)) {
      // Functions are lazily-compiled, so we proxy the first request to the gatsby develop server
      console.log(
        "No compiled function found. Proxying to gatsby develop server"
      );
      return proxyRequest(event, res);
    }

    try {
      delete require.cache[require.resolve(pathToFunction)];
      const fn = require(pathToFunction);

      const fnToExecute = (fn && fn.default) || fn;

      await Promise.resolve(fnToExecute(req, res));
    } catch (e) {
      console.error(e);
      // Don't send the error if that would cause another error.
      if (!res.headersSent) {
        res
          .status(500)
          .send(
            `Error when executing function "${functionObj.originalRelativeFilePath}": "${e.message}"`
          );
      }
    }

    const end = Date.now();
    console.log(
      `Executed function "/api/${functionObj.functionRoute}" in ${
        end - start
      }ms`
    );
  } else {
    res.status(404).send("Not found");
  }
};