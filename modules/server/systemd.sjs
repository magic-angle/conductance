#!/usr/bin/env sjs
// vim: syntax=sjs:

/* (c) 2013-2017 Oni Labs, http://onilabs.com
 *
 * This file is part of Conductance, http://conductance.io/
 *
 * It is subject to the license terms in the LICENSE file
 * found in the top-level directory of this distribution.
 * No part of Conductance, including this file, may be
 * copied, modified, propagated, or distributed except
 * according to the terms contained in the LICENSE file.
 */


/**
  @summary Utilities for defining systemd units
  @hostenv nodejs
*/

var fs = require('sjs:nodejs/fs');
var stream = require('sjs:nodejs/stream');
var child_process = require('sjs:nodejs/child-process');
var path = require('nodejs:path');
var seq  = require('sjs:sequence');
var { Stream, concat, each, map, toArray, filter, find, any, join, hasElem, transform } = seq;
var string = require('sjs:string');
var array = require('sjs:array');
var { isArrayLike } = array;
var object = require('sjs:object');
var { ownKeys, ownValues, hasOwn, ownPropertyPairs, merge, pairsToObject, getPath } = object;
var shell_quote = require('sjs:shell-quote');
var dashdash = require('sjs:dashdash');
var logging = require('sjs:logging');
var assert = require('sjs:assert');
var Url = require('sjs:url');
var sys = require('sjs:sys');
var { inspect } = require('sjs:debug');

var conductance = require('./_config');
var env = require('./env');

var fail = function(msg) {
	throw new Error(msg);
}

var CONDUCTANCE_PREFIX = 'X-Conductance-';
var CONDUCTANCE_FLAG = 'X-Conductance-Generated';
var CONDUCTANCE_FORMAT_FLAG = 'X-Conductance-Format';
var CONDUCTANCE_FORMAT = exports._format = 1;
var CONDUCTANCE_GROUP_FLAG = 'X-Conductance-Group';

var DEFAULT_GROUP = 'conductance';


/**
  @class Group
  @summary A set of related systemd components
  @function Group
  @param {optional String} [name="conductance"]
  @param {Object} [components]
  @desc
    Creates a group of systemd services.

    `components` is an object with keys for each component of your
    application, and whose values are single (or arrays of) [::Unit] objects.

    Each component can have one or more units, but cannot have multiple units
    of the same type. That is, a typical conductance server component will
    have both a [::Socket] and [::Service] unit, but cannot (for example)
    have multiple [::Service] units.

    When a group is installed, all units from all components are installed with the
    naming scheme `"#{groupName}-#{componentName}.#{unitType}"`.

    An additional unit will be created for each group, named `"#{groupName}.target"`.

    ### Example:

    This example defines two components: the main conductance server, and a periodic task
    that will backup the database immediately on boot and periodically every 4 hours.
    This allows you to combine cron-like tasks and other required services with your
    application config, rather than managing them system-wide.

        var env = require('mho:server/env');
        var { Group, ConductanceArgs, Service, Socket, Timer } = require('mho:server/systemd');
        var { Port } = require('mho:server');

        var serverAddress = Port(8080);

        exports.systemd = Group("my-app",
          {
            main: [
              Service({
                Restart: 'always',
                User: 'myapp',
                Group: 'myapp',
                Environment: {
                  'NODE_ENV': 'production',
                },
                'ExecStart': ConductanceArgs.concat('serve', env.config().path),
              }),
              // use socket activation
              Socket({
                Listen: serverAddress,
              }),
            ],

            'db-backup': [
              Service({
                'ExecStart': '/usr/local/bin/db-backup',
              }),
              Timer({
                'OnBootSec': '0m',
                'OnActiveSec': '4h',
              }),
          });
    


    For the possible types you can use as values to [::Service], [::Socket], etc, see
    the documentatino for [::Unit].
    The following types are supported as setting values:

     - The `Environment` setting may be an
       object literal - its [sjs:object::ownPropertyPairs] will be
       collected and converted to "#{key}=#{value}" format.

     - `Exec*` settings may be an array, in which case
       they will be escaped using [sjs:shell-quote::].

     - For all other cases, Arrays will be repeated as
       multiple values of the same key, e.g: `{key: [1,2,3]}`
       will be converted to:

           key=1
           key=2
           key=3

     - `null` and `undefined` settings will be ignored

     - all other non-string settings will be coerced to a String
*/

var GroupProto = Object.create({});
var Group = exports.Group = object.Constructor(GroupProto);

GroupProto._init = function(name, components) {
	if (arguments.length < 2) {
		components = arguments[0];
		name = DEFAULT_GROUP;
	}
	this.name = name;
	this.unitFilename = "#{this.name}.target";
	this.components = this._processComponents(components, this.unitFilename);
};

GroupProto.unit = -> this._addMandatorySettings(Unit('Target', null, {
	'Unit':    { Description: "Oni Conductance target" },
	'Install': { WantedBy: "multi-user.target" },
}));

GroupProto._addMandatorySettings = function(unit) {
	// add common settings
	unit.override('Unit', [
		[CONDUCTANCE_FLAG, 'true'],
		[CONDUCTANCE_FORMAT_FLAG, String(CONDUCTANCE_FORMAT)],
		[CONDUCTANCE_GROUP_FLAG, this.name],
	] .. pairsToObject());
	return unit;
}

GroupProto._processComponents = function(components, groupTarget) {
	assert.object(components, "Group components");
	components .. ownPropertyPairs .. each {|[key, units]|
		if (!Array.isArray(units)) {
			// promote single unit object into an array
			components[key] = [units];
		}
	}

	components .. ownPropertyPairs .. each {|[name, units]|
		units .. each {|unit|
			if (!UnitProto.isPrototypeOf(unit)) {
				fail("Not a systemd.Unit object: #{unit .. inspect}");
			}
		}

		var fqn = "#{this.name}-#{name}";
		var unitTypes = units .. map(u -> u.type);
		if ((unitTypes .. seq.unique()).length < unitTypes.length) {
			fail("#{fqn} component contains duplicate unit types");
		}

		// trigger types are units that will activate a service.
		var triggerTypes = ['socket', 'timer'];
		var hasTrigger = triggerTypes .. array.haveCommonElements(unitTypes);

		units .. each {|unit|
			this._addMandatorySettings(unit);

			// add in defaults or each unit type
			if (unit.type == 'service') {

				// if there's a socket unit depend upon it
				if (unitTypes .. hasElem('socket')) {
					unit.setDefault('Unit', {
						'Requires': ["#{fqn}.socket"],
					});
				}

				unit.setDefault('Unit', {
					'After': ['local-fs.target', 'network.target'],
				});

				unit.setDefault('Service', {
					// fully qualify both `node` and `sjs` executables to ensure we get the right runtime
					'ExecStart': exports.ConductanceArgs.concat('serve', env.configPath()),
					'SyslogIdentifier': fqn,
				});

				// If we don't have any trigger units defined, we bind this
				// service directly to the group target
				if (!hasTrigger) {
					unit.setDefault('Unit', { 'PartOf': groupTarget });
					unit.setDefault('Install', { 'WantedBy': groupTarget });
				}

			} else {
				// all non-service units are bound to the group target
				unit.setDefault('Unit', { 'PartOf': groupTarget });
				unit.setDefault('Install', { 'WantedBy': groupTarget });
			}

			if (unit.type == 'socket') {
				// socket.listen is intended for `ports` style objects,
				// we move it to socket.ListenStream after processing
				var ports = unit.sections .. getPath('Socket.Listen', null);
				if (ports !== null) {
					var socket = unit.sections['Socket'];
					delete socket['Listen'];

					if (!Array.isArray(ports)) ports = [ports];
					socket['ListenStream'] = ports .. map(p -> p.getAddress ? p.getAddress() : p);
				}
			}
		};
	};
	
	return components;
};

/**
  @class Unit
  @summary A systemd unit
  @desc
    Represents a systemd unit, suitable for passing to [::Group].

    Generally, it's more convenient to use the shorthand functions to create
    units of standard types:

    - [::Service]
    - [::Socket]
    - [::Timer]

    `type` should be a lowercase string like "socket", "service", etc.

    A systemd unit is made up of multiple sections. The primary section is
    named after the type (e.g the promary section for a service is the "Service"
    section). The keys and values specified in `primarySettings` will be used for the primary section.

    If you need to specify additional sections (e.g "Unit"), you should pass
    these in `additionalSettings`. This is an object with keys for each section, and
    nested objects for that section's settings.

    To understand what settings you should configure, consult
    [the systemd.unit documentation](http://www.freedesktop.org/software/systemd/man/systemd.unit.html).

    ### Example:

        Unit('service', {
          Restart: 'always',
          User: 'myapp',
          ExecStart: ConductanceArgs.concat('serve', env.config().path),
        }, {
          Install: {
            WantedBy: 'multi-user.target',
          }
        });


    ### Value types:

    The following types are supported as values for any setting:

     - `String`: this will be written to the configuration file without
       any processing.

     - `null` or `undefined`: these settings will be ignored

     - `Array`: in general, Arrays will be repeated as
       multiple values of the same key, e.g: `{key: [1,2,3]}`
       will be converted to:

           key=1
           key=2
           key=3

       (read below for property-exceptions to this behaviour)

     - all other non-string settings will be coerced into a String

     There are some property-specific exceptions to the above conversion rules:

     - A value for the `Environment` setting may be:

        - a string: `"key=value"`
        - an array of strings: `[["key1=value1", "key2=value2"]]`
        - an array of pairs: `[["key1", "value1"], ["key2", "value2"]]`
        - or an object literal: `{ "key1": "value1", "key2": "value2" }`

       If given a string or array of strings, those strings will be written as-is
       to the configuration file without any escaping.
       If given an array of pairs or an object, the keys and values will be escaped (so
       that special characters and spaces are represented literally, rather than
       interpreted by systemd.

     - `Exec*` values may be an array, in which case
       they will be escaped using [sjs:shell-quote::].

     - Socket units may specify a [server::Port] object (or array of such objects)
       as a `Listen` setting. These will be formatted appropriately for systemd
       and moved to the `ListenStream` setting.

     ### Default values

     In some cases, conductance will add default values to unit settings.
     These should almost always be what you want, but in the event that they are
     incorrect, you can override them:

      - The ExecStart setting of a service unit defaults to:
        `[::ConductanceArgs].concat(["serve", [env::conductancePath]()])`

      - The `After` setting of a service unit defaults to
        `['local-fs.target','network.target']`.

      - All units default their `WantedBy` setting to the
        group target they're a memeber of (e.g "conductance.target").

        A single service unit will also default the `PartOf` setting to
        this same group target. If a service is accompanied by a socket
        or timer group, it's assumed that these other units will trigger
        the service on-demand: those units will have the `PartOf` setting
        defaulted to the name og the group target, while the service unit
        will not (and therefore won't be started until needed, e.g via
        socket activation).

  @function Unit
  @param {String} [type]
  @param {Object|null} [primarySettings]
  @param {optional Object} [additionalSettings]

*/
var titleCase = (s) -> s.charAt(0).toUpperCase() + s.slice(1);

var UnitProto = Object.create({});
UnitProto._init = function(type, attrs, sections) {
	sections = sections ? object.clone(sections) : {};
	if (attrs) {
		var primarySection = type .. titleCase();
		assert.notOk(sections .. hasOwn(primarySection), "additional sections includes #{primarySection}");
		sections[primarySection] = object.clone(attrs);
	}

	// Check for non-normalized section names.
	// These _could_ be valid multi-word sections we don't know about, so just warn
	sections .. ownKeys .. each {|key|
		var normalized = key .. titleCase();
		if (key != normalized) {
			logging.warn("Unknown systemd unit section #{inspect(key)} - did you mean #{inspect(normalized)}?");
		}
	}


	this.sections = sections;
	this.type = type.toLowerCase();
};

UnitProto.ensureSection = function(section) {
	if (!this.sections .. hasOwn(section)) {
		this.sections[section] = {};
	}
	return this.sections[section];
};

UnitProto.setDefault = function(section, attrs) {
	this.sections[section] = object.merge(attrs, this.ensureSection(section));
};

UnitProto.override = function(section, attrs) {
	this.sections[section] = object.merge(this.ensureSection(section), attrs);
};

var Unit = exports.Unit = object.Constructor(UnitProto);

/**
  @class Service
  @summary A systemd service unit
  @function Service
  @param {Object|null} [serviceSettings]
  @param {optional Object} [additionalSettings]
  @summary Shorthand for creating a [::Unit] with type `'service'`

  @class Socket
  @summary A systemd socket unit
  @function Socket
  @param {Object|null} [socketSettings]
  @param {optional Object} [additionalSettings]
  @summary Shorthand for creating a [::Unit] with type `'socket'`

  @class Timer
  @summary A systemd timer unit
  @function Timer
  @param {Object|null} [timerSettings]
  @param {optional Object} [additionalSettings]
  @summary Shorthand for creating a [::Unit] with type `'timer'`
*/
exports.Service = () -> Unit.apply(null, ['service'].concat(arguments .. toArray));
exports.Socket  = () -> Unit.apply(null, ['socket' ].concat(arguments .. toArray));
exports.Timer   = () -> Unit.apply(null, ['timer'  ].concat(arguments .. toArray));

/**
  @variable ConductanceArgs
  @type Array
  @summary Command-line arguments used to launch this conductance installation
  @desc
    This array contains the exact arguments used to launch this conductance
    instance. You should use this in your service `ExecStart` settings
    so that your service doesn't rely on $PATH.


    ### Example:

        var { Service, ConductanceArgs } = require('mho:server/systemd');

        var service = Service({
          ExecStart: ConductanceArgs.concat([exec, <module URL> ]);
          // ...
        });

    Note: the [::Service] constructor sets a default `ExecStart` setting, so you
    often don't need to set this yourself.
  */
exports.ConductanceArgs = [
	process.execPath,
	sys.executable,
	path.join(env.conductanceRoot, 'modules/server/main.sjs'),
];

var parseArgs = function(command, options, args) {
	var parser = dashdash.createParser({ options: options });
	var opts = parser.parse(args);
	if (opts.help) {
		logging.print("Usage: conductance systemd #{command} [OPTIONS]\nOPTIONS:\n#{parser.help()}");
		process.exit(0);
	}
	if (!opts.dest) {
		// default to system / user location
		opts.dest = opts.user ? (process.env['HOME'] + '/.config/systemd/user/') : '/etc/systemd/system';
	}
	if (opts.verbose) logging.setLevel(logging.DEBUG);
	logging.verbose("Using systemd root: #{opts.dest}");
	return opts;
};

/* Assert that no arguments were passed */
var noargs = function(opts, msg) {
	if (opts._args.length > 0) {
		fail(msg || "Extra arguments provided");
	}
};

/**
 * simple wrapper around common systemctl operations
 */
var SystemCtl = function(opts) {
	this.opts = opts;
	this.mainTargets = opts.groups .. map(name -> "#{name}.target");
};
exports._SystemCtl = SystemCtl;

SystemCtl.prototype._run = function(args, opts, quiet) {
	if (this.opts.files_only) return null;
	if (!opts) opts = {};
	var _args = [];
	if(this.opts.user === true) {
		args.unshift('--user');
	}
	args = _args.concat(args);
	logging[quiet === true ? 'debug' : 'info'](" - running: systemctl #{args.join(" ")}");
	try {
		return child_process.run('systemctl', args, {stdio:[0, 1, 'pipe']} .. merge(opts));
	} catch(e) {
		if (e.stderr) console.warn(e.stderr);
		throw e;
	}
};

SystemCtl.prototype._run_output = function(args) {
	if (this.opts.files_only) return '';
	return this._run(args, {stdio: [process.stdin, 'pipe', process.stderr]}, true).stdout;
}

SystemCtl.prototype._runUnits = function (action, units) {
	if (units.length == 0) {
		throw new Error("No units given to #{action} action.");
	}
	return this._run([action].concat(units));
}

SystemCtl.prototype.installedUnits = -> installedUnits(this.opts) .. map(u -> u.name);

SystemCtl.prototype.controlUnits = function() {
	// controlUnits are those that should be started / stopped / etc.
	// if `--all` is passed in as an option, this returns all installed units.
	// Otherwise, this returns the per-group `.target` unit
	if (this.opts.all) {
		return this.installedUnits();
	} else {
		return this.mainTargets;
	}
};

SystemCtl.prototype.reloadConfig = ()      -> this._run(['daemon-reload']);
SystemCtl.prototype.reinstall    = (units) -> this._runUnits('reenable', units);
SystemCtl.prototype.uninstall    = (units) -> this._runUnits('disable', units);
SystemCtl.prototype.start        = (units) -> this._runUnits('start', units);
SystemCtl.prototype.stop         = (units) -> this._runUnits('stop', units);
SystemCtl.prototype.status       = (units) -> this._runUnits('status', units);

SystemCtl.prototype.stopUnwanted = function() {
	// TODO: there should be a more specific call we can make here:
	var unwanted = [];
	this._presentUnits() .. each {|unitName|
		var props = this._unitProperties(unitName, [
			'LoadState',
			'ActiveState',
			'SubState',
			'UnitFileState',
		]);

		if (props.ActiveState === 'failed') {
			logging.debug("unit #{unitName} is in failed state - skipping");
			continue;
		}
		if (props.UnitFileState === '') {
			logging.debug("activeState is '#{props.ActiveState}', but unit file is '#{props.UnitFileState}'");
			unwanted.push(unitName);
		} else {
			logging.debug("unit #{unitName} has file state #{props.UnitFileState} - skipping");
		}
	}

	if (unwanted.length > 0) {
		logging.debug("Stopping unwanted units:", unwanted);
		this.stop(unwanted);
	} else {
		logging.info("No unwanted units running");
	}
};

SystemCtl.prototype._unitProperties = function(unit, propertyNames) {
	assert.ok(propertyNames.length > 0, "must provide at least one property name");
	var args = seq.concat(
		['show', '-p'],
		propertyNames .. seq.intersperse('-p'),
		['--', unit]) .. toArray;

	var output = this._run_output(args);

	var props = {};
	output.split('\n')
		.. each {|line|
			line = line.trim();
			if (!line) continue;
			var [key, val] = line .. string.split('=', 1);
			props[key.trim()] = val.trim();
		};
	//logging.debug("Unit #{unit} has props:", props);
	return props;
};

SystemCtl.prototype._presentUnits = function() {
	if (this.opts.files_only) return [];

	var output = this._run_output(['list-units', '--no-legend', '--no-pager', '--full']);
	output = output.split('\n')
	.. filter(line -> line.trim())
	.. map (function(line) {
			return line.trim().split(/\s/)[0];
		});

	// XXX: use FragmentPath to parse existing unit file, and ignore files which do not have
	// CONDUCTANCE_FLAG or which have a differing CONDUCTANCE_GROUP_FLAG set to a different group

	var units = this.opts.groups .. transform(function(namespace) {
		return output
		.. filter(name -> name .. string.startsWith(namespace));
	}) .. concat .. toArray;
	logging.debug("Currently running unit names: ", units);
	return units;
};

SystemCtl.prototype._activeUnits = function() {
	return this._presentUnits()
		.. filter((name) =>
			this._unitProperties(name, ['ActiveState'])['ActiveState'] == 'active')
		.. toArray;
};

SystemCtl.prototype.reloadOrTryRestart = function(units) {
	this._runUnits('reload-or-try-restart', units);
};

SystemCtl.prototype.restart = function(units) {
	var [cleanUnits, uncleanUnits] = units .. seq.partition(unit ->
		unit .. string.endsWith('.socket') || unit .. string.endsWith('.target')
	) .. map(toArray);
	
	// non-socket units can't restart cleanly (but will have no
	// downtime if they are covered by socket unit)
	logging.debug("stopping units: ", uncleanUnits);

	if (uncleanUnits.length > 0) {
		this.stop(uncleanUnits);
	}

	// socket units can restart cleanly
	if (cleanUnits.length > 0) {
		this._runUnits('restart', cleanUnits);
	}
	this.start(units);
}

SystemCtl.prototype.log = function(units, args) {
	var cmdline = units .. map(u -> ['--unit', u]) .. concat .. toArray;
	cmdline = cmdline.concat(args);
	logging.info(" - running: journalctl #{cmdline.join(" ")}");
	return child_process.run('journalctl', cmdline, {stdio:'inherit'});
};


/**
 * Confirm an action i opts.interactive is set
 */
var confirm = function(opts, msg) {
	if (!opts.interactive) return;
	if(!msg) msg = "Continue? [y/N]";
	var debug = require('sjs:debug');
	var response = debug.prompt(msg + " ");
	if (response !== 'y') fail("User cancelled...");
}

/**
 * Ensure directory exists
 */
var ensureDir = function(dir, quiet) {
	if (!fs.exists(dir)) {
		if(!quiet) logging.info("#{dir} does not exist - creating it");
		ensureDir(path.dirname(dir), true);
		fs.mkdir(dir);
	}
}

/**
 * Return a list of all installed units
 * under the given groups.
 */
var installedUnits = function(opts, exclude) {
	exclude = (exclude || []) .. map(u -> u.name);

	var nameFilter = function(target) {
		if (exclude .. seq.hasElem(target)) {
			return false;
		}
		return opts.groups .. any((namespace) -> (
			target .. string.startsWith("#{namespace}-") ||
			target == "#{namespace}.target"));
	};

	var keyFilter = function(keys, target) {
		var group = keys[CONDUCTANCE_GROUP_FLAG];
		if (group && !opts.groups .. seq.hasElem(group)) {
			logging.debug(
				"Unit #{target} belongs to group #{group}, not #{ opts.groups .. join("|")}"
			);
			return false;
		}
		return true;
	};

	return filterInstalledUnits(opts, nameFilter, keyFilter);
}

/**
 * Like installedUnits(), but
 * returns all units installed by conductance, regardless of group
 */
var allConductanceUnits = function(opts) {
	return filterInstalledUnits(opts, null, null);
}


// helper used by installedUnits and allConductanceUnits
var filterInstalledUnits = function(opts, nameFilter, keyFilter) {
	var base = opts.dest;
	var unit_files = fs.readdir(base);
	logging.debug("installed unit files:", unit_files);

	var rv = unit_files;
	if(nameFilter) rv = rv .. filter(nameFilter);
	rv = rv .. filter(function(target) {
		try {
			var keys = loadConductanceProperties(path.join(base, target));
		} catch(e) {
			switch(e.code) {
				case 'EISDIR':
				case 'ENOENT':
					return false;
					break;
				default:
					throw e;
			}
		}
		if (!keys[CONDUCTANCE_FLAG]) {
			logging.debug("Not a conductance unit: #{target}");
			return false;
		}
		if (keyFilter) return keyFilter(keys, target);
		return true;
	});

	return rv .. toArray
		.. map(u -> new UnitFile(opts.dest, u));
};

function loadConductanceProperties(unitPath) {
	var contents = fs.readFile(unitPath).toString();
	var trim = x -> x.trim();
	var keys = contents.split('\n')
		.. map(trim)
		.. filter(line -> line .. string.startsWith(CONDUCTANCE_PREFIX))
		.. map(line -> line .. string.split('=', 1) .. map(trim) .. toArray)
		.. pairsToObject();
	logging.debug("Conductance keys extracted:", keys)
	
	// convert flag to bool
	keys[CONDUCTANCE_FLAG] = keys[CONDUCTANCE_FLAG] === 'true';
	return keys;
};

/**
 * Execute a block in a specific director
 */
var chdir = function(dir, block) {
	var old = process.cwd();
	process.chdir(dir);
	try {
		block();
	} finally {
		process.chdir(old);
	}
}

var uninstallExistingUnits = exports._uninstallExistingUnits = function(opts, exclude) {
	var old_units = installedUnits(opts, exclude);
	uninstallUnits(opts, old_units);
	return old_units;
}

var uninstallUnits = function(opts, units) {
	if (units.length > 0) {
		var unitNames = units .. map(u -> u.name);
		logging.print(
			["Uninstalling #{unitNames.length} units from #{opts.dest}:"]
			.concat(unitNames).join("\n - "));
		confirm(opts);
		var ctl = new SystemCtl(opts);
		try {
			ctl.stop(unitNames);
		} catch(e) {
			if (!opts.force) throw e;
		}
		ctl.uninstall(unitNames);
		units .. each {|unit|
			if (fs.exists(unit.path())) {
				fs.unlink(unit.path());
			}
		}
	}
};

var firstDuplicate = function(arr) {
	// assumes all values are truthy (or at least !== null)
	var last = null;
	arr .. each {|item|
		if (item === last) return item;
		last = item;
	}
	return null;
}

var uninstall = exports._uninstall = function(opts) {
	var base = opts.dest;
	if (!fs.exists(base)) {
		fail("#{base} does not exist");
	}

	if(opts.all) {
		uninstallUnits(opts, allConductanceUnits(opts));
	} else {
		uninstallExistingUnits(opts);
	}
}

/**
 * Unit file abstraction
 */
function UnitFile(base, filename, unit) {
	assert.string(base, 'base');
	assert.string(filename, 'filename');
	this.base = base;
	this.name = filename;
	this.sections = {};

	if (unit) {
		assert.ok(UnitProto.isPrototypeOf(unit), `invalid unit: $unit`);
		unit.sections .. ownPropertyPairs() .. each {|[name, conf]|
			this.addSection(name, conf);
		}
	}
}

UnitFile.prototype.addSection = function(name, conf) {
	var section;
	if (this.sections .. hasOwn(name)) {
		section = this.sections[name];
	} else {
		section = this.sections[name] = [];
	}

	if (!isArrayLike(conf)) {
		// convert obj to list of pairs
		conf = conf .. ownPropertyPairs();
	}

	// flatten arrays into lists of params, for consistency
	conf .. each {|[key,val]|

		// special-cased conversions:
		if (key .. string.startsWith('Exec') && val .. isArrayLike()) {
			val = shell_quote.quote(val);
		} else if (key === 'Environment' && !val .. string.isString()) {
			if (!val .. isArrayLike()) {
				val = val .. ownPropertyPairs;
			}
			// now turn pairs into env strings
			val = val .. map(function(pair) {
				if (isArrayLike(pair)) {
					var [k, v] = pair;
					return "#{k}=#{shell_quote.quote([v])}";
				} else {
					assert.string(pair, `Environment value: $pair`);
					return pair;
				}
			});
		}

		if (val == null) continue;

		var vals = (val .. isArrayLike()) ? val : [val];
		vals .. each {|val|
			assert.string(val, `value for ${key} is ${typeof(val)}: ${val}`);
			section.push([key, val]);
		}
	}
}

UnitFile.prototype.write = function() {
	ensureDir(this.base);
	fs.withWriteStream(this.path(), this._write.bind(this));
}

UnitFile.prototype.toString = -> "<UnitFile(#{this.name})>";

var fst = pair -> pair[0];

UnitFile.prototype._write = function(dest) {
	var self = this;
	return Stream(function(emit) {
		self.sections .. ownPropertyPairs .. each {|[name, params]|
			emit("[#{name}]");
			params .. seq.sortBy([key, val] -> key) .. each {|[key,val]|
				emit(key + '=' + val);
			}
			emit("");
		}
	}) .. seq.intersperse("\n") .. stream.pump(dest);
};

UnitFile.prototype.path = -> path.join(this.base, this.name);
exports._UnitFile = UnitFile;

var loadGroup = function(configPath) {
	var config = conductance.loadConfig(configPath);
	var group = config.systemd;
	if (!group) {
		fail("No systemd config for #{configPath}");
	}
	
	// allow lazy definitions
	if (group instanceof(Function)) group = group();

	if (!GroupProto.isPrototypeOf(group)) {
		throw new Error("exports.systemd should be (or return) a systemd.Group");
	}
	return group;
};

var defaultConfig = function() {
	var config = conductance.defaultConfig();
	return config;
};

var install = exports._install = function(opts) {
	var base = opts.dest;
	var mkUnitFile = (name, unit) -> new UnitFile(opts.dest, name, unit);
	ensureDir(opts.dest);

	var configFiles = opts._args;
	if (configFiles.length == 0) {
		configFiles = [defaultConfig()];
	}

	var namespaces = {};

	configFiles .. each {|configPath|
		var group = loadGroup(configPath);

		var namespace = group.name;
		if (namespaces .. hasOwn(namespace)) {
			fail("Duplicate systemd group detected (#{namespace}) - no files written");
		}

		var targetFile = mkUnitFile(group.unitFilename, group.unit());

		var unitFiles = group.components .. ownPropertyPairs .. map (function([name, units]) {
			var fqn = "#{namespace}-#{name}";
			return units .. map(unit -> mkUnitFile("#{fqn}.#{unit.type}", unit));
		}) .. concat .. toArray;

		namespaces[namespace] = [targetFile].concat(unitFiles);
	};


	opts.groups = namespaces .. ownKeys .. toArray;

	// combine units from all namespaces
	var allUnits = namespaces .. ownValues .. concat .. toArray;

	// check for duplicates
	var unitNames = allUnits .. map(u -> u.name) .. seq.sort();

	var firstDupe = firstDuplicate(unitNames);
	if (firstDupe !== null) {
		fail("Duplicate unit file detected (#{firstDupe}) - no files written");
	}

	uninstallExistingUnits(opts, allUnits);

	logging.info(["Installing:"].concat(unitNames).join("\n - "));
	confirm(opts);
	allUnits .. each {|unit|
		unit.write();
	}

	var ctl = new SystemCtl(opts);
	ctl.reinstall(unitNames);

	logging.info("Reloading config ...");
	ctl.reloadConfig();

	if (opts.no_restart) {
		logging.info("Starting new services ...");
	} else {
		logging.info("Restarting services ...");
		ctl.reloadOrTryRestart(ctl.installedUnits());
	}
	ctl.start(ctl.mainTargets);
}

exports._main = function(args) {
	var commonOptions = [
			{
				name: 'dest',
				type: 'string',
				help: 'Override default systemd unit location',
			},
			{
				names: ['verbose','v'],
				type: 'bool',
			},
			{
				name: 'user',
				type: 'bool',
				help: 'Run all systemd commands with the --user flag'
			},
			{
				names: ['help','h'],
				type: 'bool',
				help: 'Show this help',
			},
	];

	var commonInstallOptions = [
		{
			name: 'no-restart',
			type: 'bool',
			help: 'don\'t restart existing units, even if their configuration has changed (this will still start new units and stop old ones)'
		},
		{
			names: ['interactive', 'i'],
			type: 'bool',
			help: 'Prompt for confirmation before changing anything'
		},
		{
			name: 'files-only',
			type: 'bool',
			help: "Create / update systemd files but don't notify systemd of changes",
		},
	];

	var groupOptions = [
		{
			names: ['config','c'],
			type: 'arrayOfString',
			help: "Act on groups defined in FILE (defaults to \"#{conductance.defaultConfig()}\")",
			'default': [],
			'helpvar':'FILE',
		},
		{
			names: ['group','g'],
			type: 'arrayOfString',
			help: "Specify group name to act on",
			'default': [],
		},
	];

	var allUnitsOptions = [
		{
			name: 'all',
			type: 'bool',
			help: "Act on all conductance units (regardless of group). If given, you should not pass any --config or --group options",
		},
	];

	if (!args) args = require("sjs:sys").argv();
	var command = args.shift();
	// everything but `install` uses groupOptions, so we include it in the default set
	var options = [commonOptions, groupOptions] .. concat .. toArray;
	var action;
	var allReplacesGroupOptions = false;

	switch(command) {
		case "install":
			options = commonOptions.concat(commonInstallOptions);
			action = install;
			break;
		case "uninstall":
			options = [commonOptions, commonInstallOptions, groupOptions, allUnitsOptions, [
				{
					name: 'force',
					type: 'bool',
					help: "Remove config files even if services can't be stopped",
				},
			]] .. concat .. toArray;
			allReplacesGroupOptions = true;
			action = uninstall;
			break;

		case "list":
			options = options.concat(allUnitsOptions);
			allReplacesGroupOptions = true;
			action = function(opts) {
				noargs(opts);
				installedUnits(opts) .. each(u -> console.log(u.name));
			};
			break;

		// undocumented action, as it shouldn't be
		// necessary (and may be removed)
		case "stop-unwanted":
			action = function(opts) {
				noargs(opts);
				var ctl = new SystemCtl(opts);
				ctl.reloadConfig();
				ctl.stopUnwanted();
			};
			break;

		case "restart":
			action = function(opts) {
				noargs(opts);
				var ctl = new SystemCtl(opts);
				ctl.reloadConfig();
				ctl.reloadOrTryRestart(ctl.installedUnits());
			};
			break;

		case "stop":
			action = function(opts) {
				noargs(opts);
				var ctl = new SystemCtl(opts);
				ctl.stop(ctl.installedUnits());
			};
			break;

		case "start":
			options = options.concat(
				{
					name: 'all',
					type: 'bool',
					help: 'Start all units, not just .target units'
				}
			);
			action = function(opts) {
				noargs(opts);
				var ctl = new SystemCtl(opts);
				ctl.reloadConfig();
				ctl.start(ctl.controlUnits());
			};
			break;

		case "log":
			action = function(opts) {
				var ctl = new SystemCtl(opts);
				ctl.log(ctl.installedUnits(), opts._args);
			};
			break;

		case "status":
			action = function(opts) {
				var ctl = new SystemCtl(opts);
				ctl.status(ctl.installedUnits(), opts._args);
			};
			break;

		default:
			var usage = "Commands:
  SYSTEM MODIFICATION:
    install:    Install units from one or more .mho config files.
                Removes previously-installed units with the same
                group name that are no longer present.

    uninstall:  Remove all currently installed conductance units in
                the given group(s), or in any group if `--all` is
                specified.

  SERVICE ACTIONS:
    list:       List installed conductance units in the given group(s).
    start:      Start conductance group(s) (noop for already-running units).
    stop:       Stop conductance group(s).
    restart:    Restart conductance group(s) (noop for inactive units).
    status:     Run systemctl status on conductance group(s).
    log:        Run journalctl on conductance group(s).

  Actions that act on groups accept `--config` or `--group` multiple times.

Global options:\n#{dashdash.createParser({ options: commonOptions }).help({indent:2})}

Pass `--help` after a valid command to show command-specific help.";

			if (command == "--help" || command == "-h") {
				logging.print(usage);
				process.exit(0);
			} else {
				var msg = command ? "Unknown command: #{command}" : "No command given";
				fail("#{msg}\n\n#{usage}");
			}
			break;
	}
	var opts = parseArgs(command, options, args);

	if (opts.group) {
		if (opts.group.length > 0 && opts.config.length > 0) {
			throw new Error("Use either --group or --config, not both.");
		}

		if (opts.group.length === 0 && opts.config.length === 0) {
			if (!(allReplacesGroupOptions && opts.all)) {
				opts.config = [defaultConfig()];
			}
		}

		if (opts.config.length > 0) {
			opts.groups = opts.config .. map(conf -> loadGroup(conf).name);
		} else {
			opts.groups = opts.group;
		}
		delete opts.group;
		delete opts.config;
		if (opts.groups.length > 0) {
			logging.info("Groups: #{opts.groups .. join(", ")}");
		}
	}

	if (allReplacesGroupOptions && opts.all) {
		var tooMuchConfig = "#{command} --all accepts no group or config arguments";
		noargs(opts, tooMuchConfig);
		if (opts.groups.length > 0) {
			fail(tooMuchConfig);
		}
	}

	action(opts);
}

exports._run = function(args) {
	try {
		exports._main(args);
	} catch(e) {
		logging.debug(String(e));
		if (e.message) logging.error(e.message);
		var rv = 1;

		// pass-through exit codes from failed subcommands (typically systemctl)
		if (e.code && e.code > 0 && e.code < 256) {
			rv = e.code;
		}
		process.exit(rv);
	}
}

if (require.main === module) {
	exports._run();
}
