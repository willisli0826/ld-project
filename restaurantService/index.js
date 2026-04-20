var express = require('express');
var fs = require('fs');
var logger = require('morgan');
var bodyParser = require('body-parser');
var LaunchDarkly = require('@launchdarkly/node-server-sdk');

var RestaurantRecord = require('./model').Restaurant;
var MemoryStorage = require('./storage').Memory;

var API_URL = '/api/restaurants';
var DEFAULT_MENU_ITEMS_FLAG_KEY = 'restaurants-include-menu-items';

var removeMenuItems = function(restaurant) {
  var clone = {};

  Object.getOwnPropertyNames(restaurant).forEach(function(key) {
    if (key !== 'menuItems') {
      clone[key] = restaurant[key];
    }
  });

  return clone;
};

var getContextFromRequest = function(req) {
  var key = req.header('User-Agent') || req.ip || 'anonymous';

  if (typeof key === 'string' && key.indexOf('iPhone') !== -1) {
    key = 'iphone';
  }

  return {
    kind: 'device',
    key: key
  };
};

var getRestaurantsPayload = function(storage, includeAllRestaurants) {
  if (includeAllRestaurants) {
    return storage.getAll();
  }

  return storage.getAll().slice(0, 5).map(removeMenuItems);
};


exports.start = function(PORT, STATIC_DIR, DATA_FILE) {
  var app = express();
  var storage = new MemoryStorage();
  var ldClient = null;
  var ldFlagKey = process.env.LAUNCHDARKLY_FLAG_KEY || DEFAULT_MENU_ITEMS_FLAG_KEY;

  if (process.env.LAUNCHDARKLY_SDK_KEY) {
    ldClient = LaunchDarkly.init(process.env.LAUNCHDARKLY_SDK_KEY);
    ldClient.waitForInitialization().then(function() {
      console.log('LaunchDarkly initialized');
    }).catch(function(err) {
      console.error('LaunchDarkly failed to initialize:', err && err.message ? err.message : err);
      ldClient = null;
    });
  } else {
    console.log('LaunchDarkly disabled: LAUNCHDARKLY_SDK_KEY is not set');
  }

  // log requests
  app.use(logger('combined'));

  // serve static files for demo client
  app.use(express.static(STATIC_DIR));

  // parse body into req.body
  app.use(bodyParser.json());

  // set header to prevent cors errors
  app.use(function(_req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'newrelic, tracestate, traceparent'),
    next();
  });


  // API
  app.get(API_URL, function(req, res, _next) {
    if (!ldClient) {
      return res.status(200).send(getRestaurantsPayload(storage, false));
    }

    return ldClient.variation(ldFlagKey, getContextFromRequest(req), false, function(err, includeAllRestaurants) {
      if (err) {
        console.error('LaunchDarkly evaluation failed:', err && err.message ? err.message : err);
      } else {
        console.log('LaunchDarkly flag "' + ldFlagKey + '" value:', includeAllRestaurants);
      }

      return res.status(200).send(getRestaurantsPayload(storage, includeAllRestaurants));
    });
  });


  app.post(API_URL, function(req, res, _next) {
    var restaurant = new RestaurantRecord(req.body);
    var errors = [];

    if (restaurant.validate(errors)) {
      storage.add(restaurant);
      return res.status(201).send(restaurant);
    }

    return res.status(400).send({error: errors});
  });

  // start the server
  // read the data from json and start the server
  fs.readFile(DATA_FILE, function(_err, data) {
    JSON.parse(data).forEach(function(restaurant) {
      storage.add(new RestaurantRecord(restaurant));
    });

    app.listen(PORT, function() {
      console.log('Go to http://localhost:' + PORT + '/');
    });
  });


  // Windows and Node.js before 0.8.9 would crash
  // https://github.com/joyent/node/issues/1553
//  try {
//    process.on('SIGINT', function() {
//      // save the storage back to the json file
//      fs.writeFile(DATA_FILE, JSON.stringify(storage.getAll()), function() {
//        process.exit(0);
//      });
//    });
//  } catch (e) {}

};
