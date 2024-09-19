/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";

// const functions = require('firebase-functions');
const { smarthome } = require("actions-on-google");
const { google } = require("googleapis");
const util = require("util");

// Initialize Homegraph
const auth = new google.auth.GoogleAuth({
  keyFilename: "smart-home-key.json",
  scopes: ["https://www.googleapis.com/auth/homegraph"],
});
const homegraph = google.homegraph({
  version: "v1",
  auth: auth,
});
// Hardcoded user ID
const USER_ID = "123";

var http = require("http");
var express = require("express");
var eapp = express();
eapp.use(express.json());
eapp.use(express.urlencoded({ extended: true }));

eapp.all("/login*", function (request, response) {
  console.log("Intercepting response ...", request.method, request.url);
  if (request.method === "GET") {
    console.log("Requesting login page");
    response.send(`
    <html>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <body>
        <form action="/login" method="post">
          <input type="text" name="responseurl" value="${request.query.responseurl}" />
          <button type="submit" style="font-size:14pt">
            Link this service to Google
          </button>
        </form>
      </body>
    </html>
  `);
  } else if (request.method === "POST") {
    console.log("Requesting login page", request.body);
    const responseurl = decodeURIComponent(request.body.responseurl);
    console.log(`Redirect to ${responseurl}`);
    return response.redirect(responseurl);
  } else {
    response.send(405, "Method Not Allowed");
  }
});

eapp.all("/fakeauth*", function (request, response) {
  console.log("Intercepting requests ...", request.query);
  console.log("Intercepting body ...", request.body);
  console.log("Intercepting header ...", request.headers);

  const responseurl = util.format(
    "%s?code=%s&state=%s",
    decodeURIComponent(request.query.redirect_uri),
    "xxxxxx",
    request.query.state
  );
  console.log(`Set redirect as ${responseurl}`);
  return response.redirect(
    `/login?responseurl=${encodeURIComponent(responseurl)}`
  );
});

eapp.all("/faketoken*", function (request, response) {
  console.log("Intercepting requests ...", request.query);
  console.log("Intercepting body ...", request.body);
  console.log("Intercepting header ...", request.headers);

  const grantType = request.query.grant_type
    ? request.query.grant_type
    : request.body.grant_type;
  const secondsInDay = 86400; // 60 * 60 * 24
  const HTTP_STATUS_OK = 200;
  console.log(`Grant type ${grantType}`);

  let obj;
  if (grantType === "authorization_code") {
    obj = {
      token_type: "bearer",
      access_token: "123access",
      refresh_token: "123refresh",
      expires_in: secondsInDay,
    };
  } else if (grantType === "refresh_token") {
    obj = {
      token_type: "bearer",
      access_token: "123access",
      expires_in: secondsInDay,
    };
  }
  response.status(HTTP_STATUS_OK).json(obj);
});

const app = smarthome();

app.onSync((body) => {
  return {
    requestId: body.requestId,
    payload: {
      agentUserId: USER_ID,
      devices: [
        {
          id: "washer",
          type: "action.devices.types.WASHER",
          traits: [
            "action.devices.traits.OnOff",
            "action.devices.traits.StartStop",
            "action.devices.traits.RunCycle",
          ],
          name: {
            defaultNames: ["My Washer"],
            name: "Washer",
            nicknames: ["Washer"],
          },
        },
        {
          id: "light",
          type: "action.devices.types.LIGHT",
          traits: [
            "action.devices.traits.Brightness",
            "action.devices.traits.OnOff",
            "action.devices.traits.ColorSetting",
          ],
          name: {
            defaultNames: [`Smart Lamp`],
            name: "Smart Lamp",
            nicknames: ["abc"],
          },
        },
        {
          id: "closet",
          type: "action.devices.types.CLOSET",
          traits: ["action.devices.traits.OpenClose"],
          name: {
            defaultNames: [`Smart Closet`],
            name: "Smart Closet",
            nicknames: ["closet"],
          },
        },
        {
          id: "fan",
          type: "action.devices.types.FAN",
          traits: ["action.devices.traits.OnOff"],
          name: {
            defaultNames: [`Smart Fan`],
            name: "Smart Fan",
            nicknames: ["fan"],
          },
        },
      ],
    },
  };
});

var storeState = { on: true, isPaused: false, isRunning: false };

const queryFirebase = async (deviceId) => {
  console.log("deviceId--", deviceId);
  return {
    on: storeState.on,
    isPaused: storeState.isPaused,
    isRunning: storeState.isRunning,
  };
};
const queryDevice = async (deviceId) => {
  const data = await queryFirebase(deviceId);
  return {
    on: data.on,
    isPaused: data.isPaused,
    isRunning: data.isRunning,
    currentRunCycle: [
      {
        currentCycle: "rinse",
        nextCycle: "spin",
        lang: "en",
      },
    ],
    currentTotalRemainingTime: 1212,
    currentCycleRemainingTime: 301,
  };
};

  app.onQuery(async (body) => {
    const { requestId } = body;
    const payload = {
      devices: {},
    };
    const queryPromises = [];
    const intent = body.inputs[0];
    for (const device of intent.payload.devices) {
      const deviceId = device.id;
      queryPromises.push(
        queryDevice(deviceId).then((data) => {
          payload.devices[deviceId] = data;
        })
      );
    }
    await Promise.all(queryPromises);
    return {
      requestId: requestId,
      payload: payload,
    };
  });

const updateDevice = async (execution, deviceId) => {
  const { params, command } = execution;
  let state;
  let ref;
  switch (command) {
    case "action.devices.commands.OnOff":
      state = { on: params.on };
      storeState.on = state.on;
      break;
    case "action.devices.commands.StartStop":
      state = { isRunning: params.start };
      storeState.isRunning = state.isRunning;
      break;
    case "action.devices.commands.PauseUnpause":
      state = { isPaused: params.pause };
      storeState.isPaused = state.isPaused;
      break;
  }

  return state;
};

app.onExecute(async (body) => {
  const { requestId } = body;
  const result = {
    ids: [],
    status: "SUCCESS",
    states: {
      online: true,
    },
  };

  const executePromises = [];
  const intent = body.inputs[0];
  for (const command of intent.payload.commands) {
    for (const device of command.devices) {
      for (const execution of command.execution) {
        executePromises.push(
          updateDevice(execution, device.id)
            .then((data) => {
              result.ids.push(device.id);
              Object.assign(result.states, data);
            })
            .catch(() => console.error("EXECUTE", device.id))
        );
      }
    }
  }

  await Promise.all(executePromises);
  return {
    requestId: requestId,
    payload: {
      commands: [result],
    },
  };
});

app.onDisconnect(() => {
  console.log("User account unlinked from Google Assistant");
  return {};
});

eapp.all("/requestsync*", async function (request, response) {
  response.set("Access-Control-Allow-Origin", "*");
  console.info(`Request SYNC for user ${USER_ID}`);
  try {
    const res = await homegraph.devices.requestSync({
      requestBody: {
        agentUserId: USER_ID,
      },
    });
    console.info("Request sync response:", res.status, res.data);
    response.json(res.data);
  } catch (err) {
    console.error(err);
    response.status(500).send(`Error requesting sync: ${err}`);
  }
});

eapp.all("/reportstate", async function (change, context) {
  console.log("Firebase write event triggered this cloud function");
  if (!app.jwt) {
    alert("Service account key is not configured");
    alert("Report state is unavailable");
    return {};
  }

  const snapshot = change.after.val();

  var syncvalue = {};
});

eapp.all("/*", function (req, res, next) {
  console.log("Intercepting requests ...", req.method);
  console.error("Intercepting requests ...", req.query);
  console.error("Intercepting body ...", req.body);
  console.error("Intercepting header ...", req.headers);
  next(); // call next() here to move on to next middleware/router
});

var httpServer = http.createServer(eapp);
httpServer.listen(8080);

const express2 = require("express");
const bodyParser = require("body-parser");

// ... app code here
const expressApp = express2().use(bodyParser.json());
let demoLogger = (req, res, next) => {
  console.error("Intercepting requests ...", req.url);
  console.error("Intercepting requests ...", req.query);
  console.error("Intercepting body ...", req.body);
  console.error("Intercepting header ...", req.headers);
  next(); // call next() here to move on to next middleware/router
};
expressApp.use(demoLogger);

expressApp.all("/*", function (req, res, next) {
  console.log("Intercepting requests ...", req.method);
  next(); // call next() here to move on to next middleware/router
});

expressApp.post("/fulfillment", app);

expressApp.listen(5000);
