var env = require('mho:env');
@ = require('mho:std');
@etcd = require('./job/etcd');
@email = require('seed:auth/email');
@server = require('mho:server');
var PROD = process.env.NODE_ENV === 'production';

function initLogLevel() {
	if (process.env['SEED_LOG_LEVEL']) {
		var lvlName = process.env['SEED_LOG_LEVEL'].toUpperCase();
		var lvl = @logging[lvlName];
		@assert.number(lvl, "not a valid log level: #{lvlName}");
		@logging.setLevel(lvl);
	}
}
initLogLevel();

function resetMonitoringVars() {
	env.clearCached([
		'datadog-sample-period',
		'datadog-batch-period',
		'datadog-backend',
	]);
	if(env.hasCached('datadog')) {
		// if datadog hasn't been created yet, we don't need to
		// mutate the backend
		env.get('datadog').setBackend(env.get('datadog-backend'));
	}
};

var seedLocal = require('mho:server/seed/local');

var numberFromEnv = function(name, def, xform) {
	var e = process.env[name];
	if (e) {
		if (xform) e = xform(e);
		return parseInt(e, 10);
	}
	return def;
};

function tryReadFile(p) {
	try {
		return @fs.readFile(p);
	} catch(e) {
		if(e.code === 'ENOENT' || e.code === 'EACCES') return null;
		throw e;
	}
}


var defaultPorts = exports.defaultPorts = {
	http: numberFromEnv('SEED_HTTP_PORT', PROD ? 80 : 8080),
	https: numberFromEnv('SEED_HTTPS_PORT', PROD ? 443 : 4043),

	local: seedLocal.defaultPort,
	master: numberFromEnv('SEED_MASTER_PORT', 7071),
	slave: numberFromEnv('SEED_SLAVE_PORT', 7072),
	fs: numberFromEnv('SEED_FS_PORT', 7073),
};
var standardPorts = {
	http:80,
	https:443,
};


var def = function(key,val, lazy) {
	@assert.ok(val !== undefined, "Undefined env key: #{key}");
	if (!env.has(key)) {
		if (lazy) {
			@assert.eq(typeof(val), 'function', key);
			env.lazy(key,val);
		} else {
			env.set(key, val)
		}
	}
}


exports.installSignalHandlers = function() {
	// when we get sigusr2, adopt envvars found in $SEED_DATA/envvars
	var ENV_ORIG = process.env .. @clone();
	var MODIFIED = {};
	process.on(env.get('ctl-signal'), function() {
		// NOTE: currently we hard-code the things we want to respond to at runtime.
		// This is just SEED_LOG_LEVEL and some DATADOG_* vars at the moment.

		function setenv(k, v, op) {
			console.log("[#{process.pid}] #{op ? op : 'Setting'} #{k}=#{v}");
			if (v === undefined) {
				delete process.env[k];
			} else {
				process.env[k] = v;
			}
		}

		try {
			var envFile = @path.join(env.get('data-root'), 'environ');
			@logging.warn("Deserializing new environment from: #{envFile}");

			// mark previously-modified keys as stale
			var old = MODIFIED .. @ownKeys .. @toArray;
			old .. @each {|key| MODIFIED[key] = false; }

			require('nodejs:fs').readFileSync(envFile, 'utf-8') .. @split("\n") .. @each {|line|
				line = line.trim();
				if(line.length == 0) continue;
				var [k,v] = line .. @split("=", 1);
				// freshly modified
				MODIFIED[k] = true;
				setenv(k, v == "" ? undefined : v);
			}

			// now revert stale modified keys
			old .. @each {|key|
				if (MODIFIED[key] != true) {
					// we didn't just re-set it
					setenv(key, ENV_ORIG[key], 'Reverting to original');
					delete MODIFIED[key];
				}
			};
			initLogLevel();
			resetMonitoringVars();
		} catch(e) {
			@logging.print("Error adopting new environ: #{e}");
		}
	});
};

exports.defaults = function() {
	def('seed-api-version', seedLocal.apiVersion);
	var devDefault = function(obj, def, msg) {
		if(obj) return obj;
		if(PROD) throw new Error(msg);
		return def;
	};
	var devDefaultEnvvar = function(name, def, msg) {
		return devDefault(process.env[name], def, msg || "$#{name} not set");
	};

	def('production', PROD);
	def('deployLoopback', false);
	def('anonymous-access', false);
	def('cors', function() {
		// if we've disabled anonymous-access, then all our APIs
		// are protected by explicit authentication, so leave
		// them open to CORS.
		return !this.get('anonymous-access');
	}, true);
	def('cors-origins', []);

	var internalHost = 'localhost';
	def('internalAddress', process.env['SEED_INTERNAL_ADDRESS'] || internalHost);
	def('local-api-endpoint', '/local/remote.api');

	var selfHost = process.env['SEED_PUBLIC_ADDRESS'] || 'localhost';
	/* ^^ used for development, accessing apps requires dnsmasq config:
		$ cat /etc/dnsmasq.d/self.conf
		address=/.localhost/127.0.0.1
	*/

	def('host-aliases', function() {
		// $SEED_HOST_ALIASES takes format:
		// <name>:<host> <name2>:<host2> ...
		var spec = process.env['SEED_HOST_ALIASES'];
		var rv = {};
		if(spec && spec.length > 0) {
			spec .. @split(' ') .. @each {|entry|
				var [name,host] = entry.split(':');
				rv[name] = host;
			}
		}
		@debug("SEED_HOST_ALIASES parsed: ", rv);
		return rv;
	}, true);
	def('host-ips', {});

	def('app-hosts', ['fs']);
	def('app-host-mappings', function() {
		var rv = {};
		var dns = require('nodejs:dns');
		// if we are lacking any host, assume it's resolvable via /etc/hosts
		var resolve = function(host) {
			waitfor(var err, address, family) {
				dns.lookup(host, resume)
			}
			if(err) throw err;
			family .. @assert.eq(4, 'expected ipv4 resolution');
			return address;
		}
		this.get('app-hosts') .. @each {|host|
			var ip = this.get("host-ip-#{host}", null);
			if(!ip) ip = resolve(host);
			rv[host] = ip;
		}
		return rv;
	}, true);
	
	// if any host aliases are defined, use vhost
	def('use-vhost', -> !this.get('host-aliases') .. @eq({}), true);

	;['proxy','master','slave'] .. @each {|service|
		def("host-#{service}",  function() {
			return process.env["SEED_#{service.toUpperCase()}_HOST"] || this.get('host-aliases')[service] || selfHost;
		}, true);
	}
	def('host-local', 'localhost');
	def('host-fs', 'fs');

	if(!PROD) def('default-proto', 'http');

	def('publicAddress', function() {
		var defaultProto = env.get('default-proto');
		var useVhost = env.get('use-vhost');
		return function(service, proto) {
			proto = proto || defaultProto;
			var origin = env.get("host-#{service}", selfHost);
			var port;
			switch(service) {
				case 'proxy':
					// never use explicit port
					port = env.get("port-#{proto}");
					break;
				case 'local':
				case 'fs':
					// always use explicit (internal) port
					port = env.get("port-#{service}");
					break;
				default:
					if(useVhost) {
						port = env.get("port-#{proto}");
					} else {
						port = env.get("port-#{service}");
					}
					break;
			}

			var rv = "#{proto}://#{origin}";
			if(standardPorts[proto] !== port) {
				rv += ":#{port}";
			}
			rv += "/";
			return rv;
		};
	}, true);

	var etcdAddr = (process.env['ETCD_ADDR'] || 'localhost:4001').split(':');

	def('etcd-host', etcdAddr[0]);
	def('etcd-port', etcdAddr[1]);
	def('etcd-ssl', function() {
		if(!PROD) return null;
		var store = this.get('key-store');
		return {
			agent: false,

			// trust a server signed by our CA
			ca:   @fs.readFile(process.env .. @get('ETCD_CA_FILE')),

			// provide our client certificate
			cert: @fs.readFile(process.env .. @get('ETCD_PEER_CERT_FILE')),
			key:  @fs.readFile(process.env .. @get('ETCD_PEER_KEY_FILE'))
		};
	}, true);
	def('etcd-proto', PROD ? 'https' : 'http');
	def('etcd', function() {
		var host = this.get('etcd-host');
		var port = this.get('etcd-port');
		var sslOpts = this.get('etcd-ssl');
		@logging.info("Connecting to etcd #{host}:#{port}");
		return new @etcd.Etcd(host, port, sslOpts);
	}, true);

	def('seed-ssl', function() {
		if (PROD) {
			var store = this.get('key-store');
			return {
				cert: @path.join(store, 'key-conductance-https.crt') .. @fs.readFile(),
				key:  @path.join(store, 'key-conductance-https.key') .. @fs.readFile(),
			};
		} else {
			var insecure = @path.join(@env.get('conductanceRoot'), 'ssl');
			return {
				cert: @path.join(insecure, 'insecure-localhost.crt') .. @fs.readFile(),
				key:  @path.join(insecure, 'insecure-localhost.key') .. @fs.readFile(),
			};
		}
	}, true);

	def('fs-ssl', function() {
		var store = this.get('key-store');
		return {
			cert: @path.join(store, 'key-all-fs-server.crt') .. @fs.readFile(),
			key:  @path.join(store, 'key-conductance-fs-server.key') .. @fs.readFile(),
		};
	}, true);

	// exposed ports
	def('port-http', defaultPorts.http);
	def('port-https', defaultPorts.https);
	def('port-master', defaultPorts.master);
	def('port-slave', defaultPorts.slave);
	def('port-local', defaultPorts.local);
	def('port-fs', defaultPorts.fs);

	def('gcd-namespace', -> devDefaultEnvvar('DATASTORE_NAMESPACE', 'seed-dev'), true);
	def('gcd-host', process.env['DATASTORE_HOST'] || (PROD ? null : 'http://localhost:8089'));
	def('use-gcd', function() {
		var backend = process.env['SEED_DB_BACKEND'] || 'gcd';
		switch(backend) {
			case 'gcd': return true;
			case 'leveldown': return false;
			default:
				throw new Error("Unknown DB backend: #{backend}");
		}
	}, true);

	def('user-storage',
		-> this.get('use-gcd')
			? require('seed:master/user-gcd').Create(this.get('gcd-namespace'))
			: require('seed:master/user-leveldown'),
		true);

	// path overrides from $ENV
	var codeRoot = @url.normalize('..', module.id) .. @url.toPath;
	var dataDir = process.env['SEED_DATA'] || @path.join(codeRoot, 'data');
	@assert.ok(@fs.exists(dataDir), "data dir does not exist: #{dataDir}");
	def('data-root', dataDir);

	def('key-store', -> devDefaultEnvvar('SEED_KEYS', @path.join(codeRoot, 'keys')), true);

	def('rsync-user', process.env['SEED_RSYNC_USER'] || null);

	def('api-keys', function() {
		var contents = @fs.readFile(@path.join(this.get('key-store'), 'key-conductance-apis.json'), 'utf-8');
		contents = contents.replace(/^\S*\/\/.*\n/gm, ''); // allow comments
		return contents .. JSON.parse;
	}, true);

	def('jwt', function() {
		var keys = this.get('key-store');
		var privateKey = tryReadFile(@path.join(keys, 'key-conductance-jwt-private.pem'));
		var publicKey = @fs.readFile(@path.join(keys, 'key-all-jwt-public.pem'));
		var {JWT} = require('./jwt');
		var opts = {
			crypto: {
				algorithm:'ES256',
				privateKey: privateKey,
				publicKey: publicKey,
			},
		};
		return new JWT(opts);
	}, true);

	def('mandrill-api-keys', -> this.get('api-keys') .. @get('mandrill'), true);
	def('gcd-credentials', function() {
		var creds = this.get('api-keys').gcd .. devDefault(null, "gcd credentials not found");
		if (!creds) return creds;
		if(Array.isArray(creds.key)) {
			// convert string array into flat string
			creds.key = creds.key .. @join("\n");
		}
		return creds;
	}, true);

	def('datadog-sample-period', -> numberFromEnv('DATADOG_SAMPLE_PERDIOD') || 30, true);
	def('datadog-batch-period', -> numberFromEnv('DATADOG_BATCH_PERIOD') || 120, true);
	def('datadog-backend', function() {
		var backend = devDefault(process.env.DATADOG_BACKEND, 'log', '$DATADOG_BACKEND');
		@info("Datadog backend: #{backend || 'real'}");
		return backend;
	}, true);

	def('datadog', function() {
		var dd = require('mho:services/datadog');
		var backend = this.get('datadog-backend');
		var hostname = require('nodejs:os').hostname();
		return dd.Datadog({
			backend: backend,
			logLevel: @logging.VERBOSE,
			apikey: this.get('api-keys') .. @get('datadog'),
			host: hostname +'.seed.onihub.com',
			defaultTags: [
				"env:#{devDefault(process.env['DATADOG_ENV'], 'dev', '$DATADOG_ENV')}",
				"hostname:#{hostname}",
			],
		});
	}, true);

	def('email-transport', @email.mandrillTransport, true);
	def('runtime-environ', -> @path.join(this.get('data-root'), 'environ'), true);
	def('ctl-signal', 'SIGUSR2');
	def('app-PATH', function() {
		var systemPaths = [
			'/usr/local/bin',
			'/usr/bin',
			'/bin',
		];
		var seedPaths = [
			process.execPath,
			@sys.executable,
			@env.executable,
		] .. @transform(@fs.realpath) .. @transform(@path.dirname);
		var appPaths = process.env .. @get('SEED_APP_PATH', '') .. @split(':');
		return @concat(seedPaths, appPaths, systemPaths) .. @filter() .. @unique() .. @join(':');
	}, true);

};

