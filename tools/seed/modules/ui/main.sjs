/**
  @require mho:surface/api-connection
  @require mho:server/seed/endpoint
 */
@ = require(['mho:std', 'mho:app', 'sjs:xbrowser/dom', './busy-indicator']);
withBusyIndicator.show();
@bridge = require('mho:rpc/bridge');
@form = require('./form');
@modal = require('./modal');
@auth = require('seed:auth');
var { @route } = require('./my-route');
@logging.setLevel(@logging.DEBUG);
var { @Countdown } = require('mho:surface/widget/countdown');
var { @isTransportError, @connect } = require('mho:rpc/bridge');
var { @Notice } = require('mho:surface/bootstrap/notice');

var OnClick = (elem, action) -> @OnClick(elem, {handle:@stopEvent}, action);


// a block to pass to `appendContent` which shows the content
// (and halts the busy indicator)
var staticContentBlock = function() {
	@withoutBusyIndicator( -> hold() );
};

var commonConnectionOptions = {
	localWrappers: [
		['mho:server/seed/endpoint', 'unmarshallEndpoint']
	],
};

document.body .. @appendContent(@GlobalCSS("
	a.appLink, a.appLink:hover, a.appLink:visited {
		color:inherit;
	}
"));

var serverControlStyle = @CSS("
	display:inline-block;
	position: absolute;
	top:20px;
	right:20px;
");

var appListHeight = 50;
var appListHl = "#E7E7EB";
var appListBg = "#F7F8FA";
var appListStyle = @CSS("
	{
		background: #{appListBg};
		border: 1px solid #{appListHl};
		border-top-width: 0;
		border-left-width: 0;
		padding: 15px 0 0;
		border-bottom-right-radius: 5px;
	}

	.glyphicon {
		position: relative;
		top:0.2em;
		margin-right: 0.5em;
	}

	ul, li {
		padding:0;
		margin:0;
		list-style-type: none;
	}

	li {
		//border-bottom: 1px solid rgba(0,0,0,0.1);
		height: #{appListHeight}px;
		font-size: #{appListHeight * 0.4}px;
		&.active {
			background: #{appListHl};
			margin-right: -1px;
			&:before {
				content: ' ';
				display:block;
				height: #{appListHeight}px;
				border: #{appListHeight/2}px solid transparent;
				border-left-width: #{appListHeight/3}px;
				width: #{appListHeight/2}px;
				position: absolute;
				left: 100%;
				border-left-color: #{appListHl};
			}
			a, a:hover {
				color: #000;
			}
		}
		a {
			display:inline-block;
			padding: #{appListHeight*0.2}px 0.8em #{appListHeight*0.1}px;
			width:100%;
			color: #999;
			&:hover {
				color: #555;
				text-decoration: none;
			}
		}
	}

");

var appNameStyle = @CSS("
	{
		white-space: nowrap;
		overflow:hidden;
	}
	.glyphicon {
		position: relative;
		top:0.2em;
	}
");

var deployDateStyle = d -> d .. @Style("text-align: right;") .. @Class("text-muted");


var appStyle = @CSS("
	.header .btn-group {
		float:right;
		//padding-top: 15px;
		font-size: 0.9em;
	}

	.log-panel .panel-heading {
		border-bottom-width: 0;
		border-bottom-left-radius:4px;
		border-bottom-right-radius:4px;
	}
	.log-panel.has-body .panel-heading {
		border-bottom-width: 1px;
		border-bottom-left-radius:0;
		border-bottom-right-radius:0;
	}

	.log-panel {
		margin-top: 5px;
		.panel-heading {
			padding: 10px;
			background-color: #fbfbfb;
			border-color: #DADADA;
		}
	}

	.log-panel .panel-body {
		padding:0;
		pre {
			margin:0;
			border: none;
			background: #444448;
			color: white;
			border-radius: 0;

			min-height: 50%;
			max-height: 500px;
			width: 100%;
			overflow:auto;
			white-space: pre;
			word-wrap: normal;
		}
	}
");

var constant = function(val) {
	return @Stream(emit -> (emit(val), hold()));
};

var confirmDelete = function(thing) {
	@modal.withOverlay({title:"Confirm Deletion"}) {|elem|
		elem .. @appendContent(`
			<div>
				<p>Really delete $thing?</p>
				<a class="btn pull-left btn-default">Cancel</a>
				<a class="btn pull-right btn-danger">Delete it</a>
			</div>
		`) {|elem|
			var buttons = elem.querySelectorAll('.btn');
			@assert.ok(buttons.length === 2, String(buttons.length));
			var cancel = buttons.item(0);
			var confirm = buttons.item(1);
			waitfor {
				cancel .. @wait('click');
				return false;
			} or {
				confirm .. @wait('click');
				return true;
			}
		}
	}
};

var editServerSettings = function(server) {
	@modal.withOverlay({title:`Server Settings`}) {|elem|
		elem .. @form.serverConfigEditor(server.config);
	}
};

var appButton = function(name, activate) {
	return @A(name, {'class':'clickable'}) .. appNameStyle .. OnClick(activate);
};

var appDisplayMessageStyle = @CSS("
{
	margin-top:1em;
	margin-right:10%;
	margin-left:5%;
	color: #888;
}
");

var relativeDate = (function() {
	var plural = n -> n === 1 ? '' : 's';
	var scales = [
		{
			unit: 1, wait: 60, max: 60,
			display: -> "seconds ago",
		},
		{
			unit: 60, max: 60,
			display: n -> "#{n} minute#{plural(n)} ago",
		},
		{
			unit: 60 * 60, max: 24,
			display: n -> "#{n} hour#{plural(n)} ago",
		},

		{
			unit: 60 * 60 * 24,
			display: n -> "#{n} day#{plural(n)} ago",
		},
	];

	return function(ts) {
		return @Stream(function(emit) {
			while(true) {
				var now = Date.now();
				var diffSec = (now - ts) / 1000;
				scales .. @each {|scale|
					var diff = diffSec / scale.unit;
					if (!scale.max || diff < scale.max) {
						var n = Math.max(1, diff) .. Math.floor();
						emit(scale.display(n));
						//@info("Holding for #{scale.wait || scale.unit} seconds");
						hold((scale.wait || scale.unit) * 1000);
						break;
					}
				}
			}
		});
	}
})();

var displayApp = function(elem, token, localApi, localServer, remoteServer, app) {
	@info("app: ", app);
	var appEndpoint = app.endpoint .. @mirror();

	var appState = @Stream(function(emit) {
		appEndpoint .. @each.track {|endpoint|
			if (!endpoint) {
				@info("appState: #{endpoint}");
				emit(endpoint);
			} else {
				try {
					endpoint.connect {|api|
						if (api.authenticate) api = api.authenticate(token);
						@info("appState: new value");
						try {
							emit(api.getApp(app.id));
							hold();
						} finally {
							// if we don't immediately inform consumers that there is no current
							// endpoint, any outstanding calls (to the API provided by api.getApp())
							// will throw a "session lost" error.
							emit(null);
						}
					}
				} catch(e) {
					if (@bridge.isTransportError(e)) {
						@warn("lost connection to app slave");
						emit(null);
					} else {
						throw e;
					}
				}
			}
		}
	}) .. @mirror;

	// states
	var RUNNING = 'running';
	var STOPPED = 'stopped';
	var STARTING = 'starting';
	var UNKNOWN = 'unknown';
	var statusClasses = {
		running: {icon: 'play', color: 'success'},
		stopped: {icon: 'stop', color: 'danger'},
		unknown: {icon: 'flash', color: 'warning'},
		starting: {icon: 'play', color: 'muted'},
	};

	var runState = @Stream(function(emit) {
		appState .. @each.track {|state|
			if(state === null) {
				emit(UNKNOWN);
			} else if (state === false) {
				emit(STOPPED);
			} else {
				state.isRunning .. @each {|running|
					if(running) emit(RUNNING);
					else if (running === false) emit(STOPPED);
					else if (running === null) emit(STARTING);
				}
			}
		}
	}) .. @mirror;

	var tailLogs = function(limit, block) {
		waitfor {
			appState .. @each.track {|state|
				if(state) {
					collapse;
					@info("tailing logs...");
					// In general, we only reset logs when `appState` is
					// truthy (i.e there is a slave assigned to this app).
					state.tailLogs(limit, block);
				}
			}
		} or {
			// But on initial load, we'll show "no logs" if there
			// is no slave
			if (!appState .. @first()) {
				block(false);
			}
			hold();
		}
	};

	var appName = app.config .. @transform(a -> a.name);

	var deployState = app.state .. @mirror();
	var deployDate = deployState .. @transform(function(state) {
		var ts = state.deployed;
		if(ts) {
			return ["Deployed ", @Span(relativeDate(ts), {'title':String(new Date(ts))})];
		} else {
			return "Not yet deployed";
		}
	});

	var statusClass = runState .. @transform(state -> "glyphicon-#{statusClasses[state].icon}");
	var statusColorClass = ['text-muted'] .. @concat(runState .. @transform(state -> "text-#{statusClasses[state].color}"));

	var disableStop = [true] .. @concat(runState .. @transform(st -> st !== RUNNING));
	var disableStart = [true] .. @concat(@observe(runState, deployState, (st, state) -> st !== STOPPED || !state.deployed));
	var endpointUnreachable = appEndpoint .. @transform(ep -> ep === null) .. @dedupe();
	var disableDeploy = [true] .. @concat(endpointUnreachable);

	var disabled = (elem, cond) -> elem .. @Class('disabled', cond);
	var logsVisible = @ObservableVar(false);
	var logDisclosureClass = logsVisible .. @transform(vis -> "glyphicon-chevron-#{vis ? 'up':'down'}");

	var editAppSettings = function(e) {
		@modal.withOverlay({title:`$appName Settings`}) {|elem|
			elem .. @form.appConfigEditor(localApi, {
					central: app.config,
					local: localServer.appConfig(app.id),
				},
				@Button('Delete', {'class':'btn-danger'}) .. OnClick(function() {
					if (!confirmDelete(appName)) return;
					elem .. @modal.spinner {||
						remoteServer.destroyApp(app .. @get('id'));
					}
				})
			);
		}
	};

	var hideSm = c -> @Span(c, {'class':'hidden-sm hidden-xs'});
	var toolBtn = (text, icon, attrs) -> @Button(["#{text} " .. hideSm, @Icon(icon)], (attrs || {}) .. @merge({title:text}));
	var toolbarAction = function(action) {
		return function(ev) {
			var btn = ev.currentTarget;
			var overlayStyle = el -> el .. @Style("border-radius: 3px; background-color: rgba(156, 147, 141, 0.55);");
			@findNode('.btn-group', btn) .. @modal.spinner(overlayStyle) {||
				action();
			}
		}
	};

	var startApp = function() {
		waitfor {
			// app.start returns as soon as the op is accepted, but we'd like the UI
			// to spin until at least the endpoint is picked
			appState .. @filter() .. @first;
		} and {
			app.start();
		}
	};

	var appDetail = @Div(`
		<div class="header">

			<div class="btn-group">
				${toolBtn("stop", 'stop')  .. disabled(disableStop) .. OnClick(toolbarAction(app.stop))}
				${toolBtn("start", 'play') .. disabled(disableStart) .. OnClick(toolbarAction(startApp))}
				${toolBtn("settings", 'cog') .. OnClick(editAppSettings)}
				${toolBtn("deploy", 'cloud-upload', {'class':'btn-danger'}) .. disabled(disableDeploy) .. OnClick(function(ev) {
					var btn = ev.currentTarget;
					btn.disabled = true;
					try {
						try {
							toolbarAction(-> localServer.deploy(app.id, @info))(ev);
						} catch(e) {
							if(e.tooLarge && e.maxkb) {
								@modal.withOverlay({title:`Application too large`}) {|elem|
									elem .. @appendContent([
										@P(`Sorry, this application is a bit big. Applications are currently limited to ${Math.floor(e.maxkb/1024)}mb.`),
										@Btn('primary', "ok") .. @Class('pull-right'),
									], (_,btn) -> btn .. @wait('click'));
								}
							} else throw e;
						}
					} finally {
						btn.disabled = false;
					}
				})}
			</div>

			${@H3([
				@Span(null, {'class':'glyphicon'}) .. @Class(statusClass),
				`&nbsp;`,
				@A(appName, {'class':'appLink'}) .. @Attrib('href', appName .. @transform(name -> @supplant(app.publicUrlTemplate, {name:name}))),
			]) .. @Class(statusColorClass) .. appNameStyle
			}
		</div>
		<div class="clearfix">
			${@P(deployDate) .. deployDateStyle}
			${
			endpointUnreachable .. @transform(err -> err
			? `<div class="alert alert-warning" role="alert">Endpoint temporarily unreachable</div>`
			: @Div(`
				<div class="panel-heading">
					${@H3(
						[@Span(null, {'class':'glyphicon pull-right'}) .. @Class(logDisclosureClass),
						"Console output"
						],
						{'class': "panel-title clickable output-toggle"})
						.. @Mechanism(function(elem) {
							var clicks = elem .. @events('click', {handle:@stopEvent});
							var panelRoot = @findNode('.log-panel', elem);
							var container = panelRoot.querySelector('.panel-body');
							var hasBody = "has-body";
							var content = @Pre(null, {'class':'output-content'}) .. @Mechanism(function(elem) {
								var placeholder = true;
								elem.textContent = " -- loading -- ";
								tailLogs(100) {|chunk|
									if (!chunk) {
										@info("logs reset");
										if(chunk === false) {
											elem.textContent = " -- no output --";
										}
										placeholder = true;
									} else {
										if (placeholder) {
											// first new output clears the placeholder
											elem.textContent = "";
										}
										placeholder = false;
										var bottom = elem.scrollTop + elem.offsetHeight;
										var contentSize = elem.scrollHeight;
										var following = (bottom >= contentSize);
										elem.textContent += chunk;
										if (following) {
											elem.scrollTop = elem.scrollHeight;
										}
									}
								}
							});

							while(true) {
								if (!logsVisible.get()) {
									clicks .. @wait();
									logsVisible.set(true);
								}
								waitfor {
									container .. @appendContent(content, ->hold());
								} or {
									clicks .. @wait();
								}
								logsVisible.set(false);
							}
						})
					}
				</div>
				<div class="panel-body">
				</div>
			`, {'class':'log-panel panel panel-default'}) .. @Class('has-body', logsVisible)
			)}
		</div>
	`) .. appStyle();

	elem .. @appendContent(appDetail, staticContentBlock);
};

var showServer = function(token, localApi, localServer, remoteServer, container, header) {
	var apps = remoteServer.apps .. @mirror();

	var addApp = @Li(@A([@Icon('plus-sign'), 'new']) .. appNameStyle, {'class':'new-app-button'})
		.. OnClick(function() {
		// make an in-memory config, and only save it to the server when
		// we submit the form
		var newConfig = {
			local: @ObservableVar({}),
			central: @ObservableVar({}),
		};
		@modal.withOverlay({title:`Create app`}) {|elem|
			if (elem .. @form.appConfigEditor(localApi, newConfig)) {
				elem .. @modal.spinner {||
					var appInfo = localServer.addApp(newConfig.local.get());
					var appId = appInfo .. @get('id');
					remoteServer.createApp(appId, newConfig.central.get());
					@route.modify(c -> c .. @merge({app:appId}));
				}
			}
		}
	});


	var logout = @Emitter();
	waitfor {
		header .. @appendContent(
			@Div(
				@Div([
					localApi.multipleServers ? @Button([@Icon('cog'), ` Settings`])
						.. OnClick(-> editServerSettings(localServer)),

					@Button([@Icon('log-out'), ` Log out`])
						.. OnClick(-> logout.emit()),
				], {'class':'btn-group'})
			) .. serverControlStyle(), ->hold());
	} or {
		container .. @appendContent(
			@Div(
			)) {|container|

			waitfor {
				while(true) {
					try {
						var activeApp = @observe(apps, @route, function(apps, route) {
							if (!route.app) return null;
							return apps .. @find(app -> app.id === route.app, null);
						}) .. @dedupe;

						activeApp.set = function(app) {
							@route.modify(function(r, unmodified) {
								if(r.app === app.id) return unmodified;
								return r .. @merge({app:app.id});
							});
						};

						var appMenu = apps .. @transform(function(apps) {
							@info("list of apps for #{localServer.id} changed...");
							var appNames = apps .. @map.par(app -> (app.config .. @first).name);
							var items = apps
								.. @indexed
								.. @map(([i, app]) -> [appNames[i], app])
								.. @sortBy(pair -> pair[0])
								.. @map(([name, app]) ->
									@Li(appButton(name, -> activeApp.set(app)))
										.. @Class("active", activeApp .. @transform(a -> a && a === app))
								);
							return @Col("xs-4 md-3",
									@Row(
										[
											@Ul(items.concat(addApp), {'class':'app-list'})
										]
								) .. appListStyle());
						});

						container .. @appendContent(@Row([
								@Div(appMenu),
								@Col('xs-8 md-9',
									@Div(null, {'class':'app-display', 'style':"margin-left: #{appListHeight/2}px;"})
								)
						])) {|elem|
							var display = elem.querySelector('.app-display');
							activeApp .. @each.track {|app|
								if (!app) {
									display .. @appendContent(apps .. @transform(apps ->
										@Div(apps.length > 0
										? [ @H3("No app selected") ]
										: [ @H3("You don't have any apps yet"),
												@P('Click the "new" button on the left to get started.'),
											]
										) .. appDisplayMessageStyle), staticContentBlock);
								} else {
									display .. displayApp(token, localApi, localServer, remoteServer, app);
								}
							}
						}
						break;
					} catch(e) {
						console.error("Error in app display: #{e}");
						var msg = e.message;
						var retry = @Emitter();
						container .. @appendContent(@Div([
							@H3(`Uncaught Error: ${msg}`),
							@P(@Button("Continue ...", {'class':'btn-danger'}) .. OnClick(-> retry.emit()))
						]), -> @withoutBusyIndicator(-> retry .. @wait()));
					}
				}
			} or {
				logout .. @wait();
				localApi.deleteServerCredentials(localServer.id);
			}
		}
	}
};

function displayServer(elem, header, api, server) {
	@assert.ok(server, "null server");
	var id = server.id;
	elem .. @appendContent(@Div(null)) {|elem|
		var initialConfig = server.config .. @first();
		var token = initialConfig.ssh || initialConfig.token;
		var updateToken = function(newToken) {
			server.config.modify(c -> c .. @merge({token: newToken}));
			token = newToken;
		};

		var initialDelay = 3000;
		var reconnectDelay = initialDelay;
		var connectionError = @ObservableVar(false);
		connectOpts = commonConnectionOptions .. @merge({connectMonitor: function() {
			hold(300); // small delay before showing ui feedback
			elem .. @appendContent(@Div('Connecting...', {'class':'alert alert-warning'}) .. @Style('display:inline-block; margin: 10px 0; padding:10px;'), -> hold());
		}});

		waitfor {
			var errorMessage = @Div([
				@H2(`Server unavailable.`),
				@P(`The server may be experiencing temporary downtime. <b>TODO: link to status page</b>`),
			]);
			connectionError .. @each.track {|err|
				if (err) {
					elem .. @appendContent(errorMessage, staticContentBlock);
				}
			}
		} or {
			while(true) {
				@info("Connecting to server #{id}");
				try {
					var localServer = api.getServer(id, document.location.origin);
					localServer.endpoint.connect(connectOpts) {|remoteServer|
						connectionError.set(false);
						reconnectDelay = initialDelay;
						@debug("Connected to server:", remoteServer);

						if (remoteServer.authenticate) {
							while (!token) {
								@info("Getting auth token...");
								var username, password;
								var loginResult = @modal.withOverlay({title:
									initialConfig.name ? `Login to ${initialConfig.name}` : `Login required`,
									close: api.multipleServers})
								{|elem|
									@form.loginDialog(elem, server.config, {
										login: function(props) {
											@modal.spinner(elem) {||
												return remoteServer.getToken(props .. @get('username'), props .. @get('password'));
											}
										},
										resendConfirmation: function(username) {
											@modal.spinner(elem) {||
												localServer.endpoint.relative('/master/user.api').connect {|auth|
													auth.sendConfirmation(username);
												}
											}
										},
										signup: function(props) {
											@modal.spinner(elem) {||
												localServer.endpoint.relative('/master/user.api').connect {|auth|
													auth.createUser(props);
												}
											}
										},
									});
								};
								if (!loginResult) {
									return;
								}

								({username, token}) = loginResult;

								server.config.modify(existing -> existing .. @merge({
										token:token,
										username: username
									}));
								@debug("Authenticated:", token);
							}
							remoteServer = remoteServer.authenticate(token);
						}
						showServer(token, api, localServer, remoteServer, elem, header);
					}
					break;
				} catch(e) {
					if (e .. @bridge.isTransportError) {
						if (connectionError.get()) {
							// still can't connect. Increase timeout
							reconnectDelay = (reconnectDelay * 1.5) .. Math.min(60000); // cap at 1min
						} else {
							reconnectDelay = initialDelay;
							connectionError.set(true);
						}
						elem .. @appendContent(@Div([
							@P(`Reconnecting in ${@Countdown((reconnectDelay/1000) .. Math.floor())}s`),
							@Button('Reconnect now...', {'class':'btn-danger'}),
						])) {|elem|
							@withoutBusyIndicator {||
								waitfor {
									hold(reconnectDelay);
									reconnectDelay *= 1.5;
									if (reconnectDelay > 60*1000*10) // cap at 10 minutes
										reconnectDelay = 60*1000*10;
								} or {
									elem.querySelector('button') .. @wait('click', {handle:@preventDefault});
								}
							}
						};
						continue;
					}
					if(@auth.isAuthenticationError(e)) {
						@info("Login required");
						updateToken(null);
					} else {
						throw e;
					}
				}
			}
		}
	};
};

function runInner(api) {
	var apiVersion = api.version;
	@assert.number(api.version);
	var minVersion = 1;
	if (apiVersion < minVersion) {
		@logging.warn("Old remote.api version #{apiVersion}");
		while(true) {
			@modal.withOverlay({title: "Version error", 'class':'panel-danger', close:false}) {|elem|
				elem .. @appendContent(
				`<h4>
					<strong>Sorry, your local Conductance installation is out of date.</strong>
				</h4>
				<p>
					To update Conductance, stop the running <code>conductance seed</code> process, and then run:
					<pre>\$ conductance self-update\n\$ conductance seed</pre>
				</p>
				<p>
					If that doesn't work, see <a href="https://conductance.io/install">conductance.io/install</a> for more details.
					(In particular, the <code>self-update</code> command is not available if you installed Conductance via <code>npm</code> or <code>git</code>.)
				</p>`, staticContentBlock);
			}
		}
		return ;
	}
	var header = document.getElementById('pageHeader');
	@assert.ok(header);

	var serverEq = function(a, b) {
		return a == b || (a ? a.id) == (b ? b.id);
	};

	var servers = api.servers;
	if (api.multipleServers) {
		@info("multi-server mode");
		// XXX deprecate?
		var activeServer = @observe(@route, api.servers, function(state, servers) {
			var id = state.server;
			if (!id) return null;
			return servers .. @find(s -> s.id === id, null);
		}) .. @dedupe;
		activeServer.get = -> activeServer .. @first();
		activeServer.set = val -> @route.set({server: val ? val.id : null});

		var displayCurrentServer = function(elem) {
			activeServer .. @each.track(function(server) {
				@info("activeServer changed");
				if (!server) {
					elem .. @appendContent([
						@H3(`No server selected`),
						@P(`Create or select a server above to get started`),
					], staticContentBlock);
				} else {
					try {
						elem .. displayServer(api, server);
						activeServer.set(null);
					} catch(e) {
						activeServer.set(null);
						throw e;
					}
				}
			});
		};

		var buttons = api.servers .. @transform(function(servers) {
			return servers .. @map(function(server) {
				@info("Server: ", server);
				var serverName = [`&hellip;`] .. @concat(server.config .. @transform(s -> s.name));
				var button = @A(serverName, {'class':'btn navbar-btn'}) .. OnClick(function(evt) {
						activeServer.set(server);
					});

				var dropdownItems = [
					@A(@Span(null, {'class':'caret'}), {'class':'btn dropdown-toggle', 'data-toggle':'dropdown'}),
					@Ul([

						@A([@Icon('cog'), ' Settings'])
							.. OnClick(->editServerSettings(server)),

						@A([@Icon('remove'), ' Delete']) .. OnClick(function() {
							if (!confirmDelete(`server ${server.config .. @first .. @get('name')}`)) return;
							@withBusyIndicator {||
								server.destroy();
							}
						}),

						@A([@Icon('log-out'), ' Log out']) .. OnClick(function() {
							localApi.deleteServerCredentials(server.id);
							if (activeServer.get() === server) activeServer.set(null);
						}) .. @Class('hidden', server.config .. @transform(c -> !c .. @hasOwn('token'))),

					], {'class':'dropdown-menu'}),
				];

				return @Li(@Div([button, dropdownItems], {'class':'btn-group'}))
					.. @Class('active', activeServer .. @transform(s -> serverEq(s, server)));
			});
		});

		var addServer = @Li(@Div(@A(@Icon('plus-sign'), {'class':'floating'})) .. OnClick(function() {
			var config = @ObservableVar({});
			@modal.withOverlay({title:`Create server`}) {|elem|
				elem .. @form.serverConfigEditor(config);
				elem .. @modal.spinner {||
					api.createServer(config.get());
				}
			}
		}));

		var serverList = buttons .. @transform(function(buttons) {
			return @Nav(
				@Div(
					@Ul(buttons.concat([addServer]), {'class':'nav nav-tabs'}),
				{'class':''}),
			{'class':''})
			.. @CSS('
				.nav > li {
					margin-left:1em;
					&:first-child {
						margin-left:0;
					}
				}

				.floating {
					display:block;
					padding: 5px;
					position:relative;
					top:0.2em;
				}

				.btn {
					box-shadow: none !important;
					background: white !important;
					border-color: #ccc !important;
				}

				.btn {
					color: #2a6496;
					margin:0;
					height:100%;
					border: 1px solid #ccc;
					border-bottom-left-radius: 0;
					border-bottom-right-radius: 0;
				}

				.active .btn {
					border-bottom:1px solid white !important;
				}

				.btn.dropdown-toggle {
					border-left-width: 0;
				}
				.navbar-btn {
					border-right-width:0;
				}
			');
		});

		@mainContent .. @appendContent([
			serverList,
			@Div(),
		]) {|_, content|
			content .. displayCurrentServer();
		}
	} else {
		@info("single-server mode");
		@mainContent .. @appendContent([
			@Div(),
		]) {|content|
			var server = api.server;
			@route.modify(function(current, unchanged) {
				if(current.server == server.id) return unchanged;
				return { server: server.id };
			});
			content .. displayServer(header, api, server);
		}
	}
};

exports.run = function(localApiAddress) {
	@withAPI(localApiAddress, commonConnectionOptions .. @merge({
		notice: -> @Notice.apply(null, arguments) .. @Class('reconnectNotification'),
		disconnectMonitor: block -> @withoutBusyIndicator(block),
	})) {|api|
		runInner(api);
	}
}

