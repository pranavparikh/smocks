var _ = require('lodash');
var Route = require('./route-model');
var Variant = require('./variant-model');
var Plugin = require('./plugin-model');

var _routes = [];
var _plugins = [];
var _variants = {};
var _profiles = {};
var _actions = {};


var smocksInstance = module.exports = {
  id: function(id) {
    if (!id) {
      return smocksInstance._id;
    }
    smocksInstance._id = id;
    return smocksInstance;
  },

  connection: function(connection) {
    if (connection) {
      smocksInstance._connection = connection;
    }
    return smocksInstance._connection;
  },

  route: function(data) {
    if (!data.path) {
      throw new Error('Routes must be in the form of {path: "...", method: "..."}');
    } else {
      var route = new Route(data, smocksInstance);
      _routes.push(route);
      return route;
    }
  },

  method: function(route, method) {
    if (route.hasVariants()) {
      // we need a new route
      var _route = this.route({ path: route.path });
      _route._method = method;
      return _route;
    } else {
      // we can repurpose the current route
      route._method = method;
      return route;
    }
  },

  variant: function(data) {
    var variant = new Variant(data, this);
    _variants[variant.id()] = variant;
    return variant;
  },

  profile: function(id, profile) {
    _profiles[id] = profile;
  },

  action: function(id, options) {
    if (!options) {
      options = id;
      id = options.id;
    } else {
      options.id = id;
    }

    _actions[id] = options;
    return this;
  },

  actions: {
    get: function() {
      return _actions;
    },
    execute: function(id, input, request) {
      var action = _actions[id];
      if (!action) {
        return false;
      } else {
        action.handler.call(smocksInstance._executionContext(request), input);
        return true;
      }
    }
  },

  profiles: {
    applyProfile: function(profile, request) {
      if (_.isString(profile)) {
        profile = _profiles[profile];
      }
      if (profile) {
        // reset the state first
        smocksInstance.state.resetRouteState(request);
        _.each(_routes, function(route) {
          route.applyProfile((route._id && profile[route._id]) || {}, request);
        });

        // FIXME we're only resetting global plugin state where we should be saving that in a profile
        smocksInstance.plugins.resetInput(request);
        return true;
      } else {
        return false;
      }
    },

    get: function(id) {
      if (!id) {
        return _profiles;
      }
      return _profiles[id];
    }
  },

  plugin: function(data) {
    var plugin = new Plugin(data, this);
    if (plugin.plugin) {
      plugin.plugin(this);
    }
    _plugins.push(plugin);
    return this;
  },

  plugins: {
    get: function() {
      return _plugins;
    },

    resetInput: function(request) {
      var state = smocksInstance.state.routeState(request);
      var pluginState = state._pluginState = {};
      _.each(_plugins, function(plugin) {
        var input = plugin.input();
        if (input) {
          pluginState[plugin.id()] = {};
          _.each(input, function(data, id) {
            smocksInstance.plugins.updateInput(plugin.id(), id, data.defaultValue, request);
          }, this);
        }
      });
    },

    updateInput: function(pluginId, id, value, request) {
      var input = smocksInstance.state.routeState(request)._pluginState;
      var pluginInput = input[pluginId];
      if (!pluginInput) {
        pluginInput = {};
        input[pluginId] = pluginInput;
      }
      pluginInput[id] = value;
    },

    getInput: function(request) {
      return smocksInstance.state.routeState(request)._pluginState;
    },

    getInputValue: function(pluginId, id, request) {
      var input = smocksInstance.state.routeState(request)._pluginState[pluginId];
      return input && input[id];
    }
  },

  routes: {
    get: function(id) {
      if (!id) {
        return _routes;
      }
      for (var i=0; i<_routes.length; i++) {
        if (_routes[i].id() === id) {
          return _routes[i];
        }
      }
    },
  },

  variants: {
    get: function(id) {
      if (!id) {
        return _.map(_variants, function(variant) { return variant; });
      }
      return _variants[id];
    }
  },

  global: function() {
    return this;
  },

  done: function() {
    return this;
  },

  findRoute: function(id) {
    return _.find(_routes, function(route) {
      return route._id === id;
    });
  },

  _sanitizeOptions: function(options) {
    options = _.clone(options || {});
    if (options.state) {
      if (options.state === 'cookie' || options.state === 'request') {
        var CookieState = require('./state/cookie-state');
        options.state = new CookieState();
      } else if (options.state === 'static') {
        options.state = require('./state/static-state');
      }
      if (!options.state.initialize) {
        console.error('state handler *must* implement "initialize" method: ', options.state);
        process.exit(1);
      }
    } else {
      options.state = require('./state/static-state')
    }

    return options;
  },

  _sanityCheckRoutes: function() {
    var routeIndex = {};
    _.each(_routes, function(route) {
      var id = route.id();
      if (routeIndex[id]) {
        console.error('duplicate route key "' + id + '"');
        process.exit(1);
      } else {
        routeIndex[id] = true;
      }

      var variants = route.variants();
      var variantIndex = {};
      _.each(variants, function(variant) {
        id = variant.id();
        if (variantIndex[id]) {
          console.error('duplicate variant key "' + id + '" for route "' + route.id() + '"');
          process.exit(1);
        } else {
          variantIndex[id] = true;
        }
      });
    });
  },

  _executionContext: function(request, route, plugin) {
    var variant = route.getActiveVariant(request);
    var details = {
      route: route,
      variant: variant
    }

    return {
      state: function(id, value) {
        if (value !== undefined) {
          smocksInstance.state.userState(request, details)[id] = value;
        } else {
          return smocksInstance.state.userState(request, details)[id];
        }
      },
      input: function(id) {
        if (plugin) {
          return smocksInstance.plugins.getInputValue(plugin.id(), id, request);
        }
        return route && route.getInputValue(id, request);
      },
      meta: function(id) {
        return route && route.getMetaValue(id);
      },
      route: route,
      variant: variant
    };
  }
};

require('./plugins/har-viewer-plugin');
require('./plugins/proxy-plugin');

module.exports = smocksInstance;
