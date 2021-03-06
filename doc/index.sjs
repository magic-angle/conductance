//TODO: use merging require([.])
waitfor {
var {RequireExternalCSS, OnClick, Class, Mechanism, Element, removeNode, appendContent, CSS} = require('mho:surface');
} and {
var seq = require('sjs:sequence');
var {map, indexed, find, each, join, transform } = seq;
} and {
var { ObservableVar, observe } = require('sjs:observable');
} and {
var array = require('sjs:array');
} and {
var event = require('sjs:event');
} and {
var {preventDefault} = require('sjs:xbrowser/dom');
} and {
var cutil = require('sjs:cutil');
} and {
var str = require('sjs:string');
} and {
var {ownPropertyPairs, ownValues, hasOwn} = require('sjs:object');
} and {
var logging = require('sjs:logging');
} and {
var http = require('sjs:http');
} and {
var Url = require('sjs:url');
} and {
var assert = require('sjs:assert');
} and {
var ui = require('./ui');
} and {
var Symbol = require('./symbol');
} and {
var Library = require('./library');
} and {
var { encodeFragment } = require('./url-util');
}

window.withBusyIndicator {|hideBusyIndicator|
	logging.setLevel(logging.INFO);
	if (document.location.hostname .. str.contains('local')) {
		logging.setLevel(logging.DEBUG);
	}

	var searchStyle = RequireExternalCSS(Url.normalize('css/search.css', module.id));

	exports.run = function(root, defaultHubs) {
		var libraries = Library.Collection();
		defaultHubs = defaultHubs || {'sjs:': null, 'mho:': null};

		var locationHash = ObservableVar(undefined);
		var symbolAnchor = null; // anchor-within-hash part of location (e.g #sjs:sequence::transform~example)

		var currentSymbol = observe(locationHash, libraries.val, function(h) {
			logging.debug("Location hash:", h);
			if (h === undefined) return undefined; // undefined: "not yet loaded"
			return Symbol.resolveSymbol(libraries, h);
		});

		var renderer = ui.renderer(libraries, new Symbol.RootSymbol(libraries));
		var symbolDocs = currentSymbol .. transform(function(sym) {
			return sym !== undefined ? renderer.renderSymbol(sym, symbolAnchor);
		});

		var breadcrumbs = currentSymbol .. transform(function(sym) {
			return sym !== undefined ? renderer.renderBreadcrumbs(sym);
		});

		var sidebar = currentSymbol .. transform(function(sym) {
			return sym !== undefined ? renderer.renderSidebar(sym);
		});

		defaultHubs .. ownPropertyPairs .. each(h -> libraries.add.apply(libraries, h));

		var hubDebug = libraries.val .. transform(function(hubs) {
			return JSON.stringify(hubs, null, '  ');
		});
		var hubDisplay = Element("pre", hubDebug);

		var toolbar = Element("div", `
				<div class="trigger">
					<button class="btn config"><span class="glyphicon glyphicon-cog"></span></button>
					<button class="btn search" title="Shortcut: s"><span class="glyphicon glyphicon-search"></span></button>
				</div>
			`)
			.. Class("popupContainer")
			.. Mechanism(function(elem) {
				var [configureButton, searchButton] = elem.getElementsByTagName("button");

				var buttonContainer = elem.getElementsByTagName("div")[0];

				var doSearch = function() {
					withBusyIndicator {|done|
						var newLocation = require('./search').run(elem, libraries, done);
						if (newLocation) {
							document.location.hash = encodeFragment(newLocation);
						}
					}
				};

				var doConfig = function() {
					withBusyIndicator {|done|
						require('./config').run(elem, libraries, defaultHubs, done);
					}
				};

				// we ignore keyboard shortcuts while we're performing an action
				var action;
				var noModifiers = (e) -> !(e.shiftKey||e.ctrlKey||e.altKey||e.metaKey);
				var FORWARD_SLASH = (e) -> (console.log(e), !action && e.which == 47 && noModifiers(e));
				var S_KEY = (e) -> !action && e.which == 115 && noModifiers(e);
				var PLUS = (e) -> !action && e.which == 43 && e.shiftKey;

				while(true) {
					waitfor {
						waitfor {
							searchButton .. event.wait('click');
						} or {
              document.body .. event.wait('keypress', {filter: e -> FORWARD_SLASH(e) || S_KEY(e), handle: preventDefault});
						}
						action = doSearch;
					} or {
						waitfor {
							configureButton .. event.wait('click');
						} or {
							document.body .. event.wait('keypress', {filter: PLUS, handle: preventDefault});
						}
						action = doConfig;
					}
					buttonContainer.classList.add('hidden');
					try {
						action();
					} finally {
						action = null;
						buttonContainer.classList.remove('hidden');
					}
				}
			});
    
		var mainDisplay = [Element('div', symbolDocs, {"class":"mb-main mb-top"})];
		var header = Element("div", [
			toolbar,
	//		`<h1>Conductance docs</h1>`
		])
			.. Class("header");

		var hint;
		if (!window.localStorage || !window.localStorage['search-hint-shown']) {
			hint =  `<div class='alert alert-warning'>Hint: You can press 's' to search the reference<a class='close' href='#'>&times;</a></div>` .. Mechanism(function(node) {
				node.querySelector('a') .. event.wait('click', {handle: preventDefault});
				if (window.localStorage)
					window.localStorage['search-hint-shown'] = true;
				node.parentNode.removeChild(node);
			});
		}


		var toplevel = Element("div", [
      searchStyle,
			sidebar,
			header,
			breadcrumbs,
			hint,
			mainDisplay,
		], {'class':'documentationRoot'});

		root .. appendContent(toplevel) {|elem|

      hideBusyIndicator();
      
      waitfor {
        // preload search module in background:
        hold(1000);
        require('./search');
      }
      and {
        function setLocationHash() {
          var location;
					[location, symbolAnchor] = document.location.hash.slice(1) .. str.split('~', 1) .. map(decodeURIComponent);
					locationHash.set(location);
        }

        setLocationHash();
        window .. event.events('hashchange') .. each {||
					setLocationHash();
				}
			}
		};
	};


	exports.main = function(root /*, ... */) {
		// wraps `run` with error handling
		var error = cutil.Condition();
		window.onerror = function(e) {
			error.set(e);
		};

		waitfor {
			var e = error.wait();
			logging.error(String(e));
			ui.withOverlay("error") {|bg|
				root .. appendContent(Element("div",
					`<h1>:-(</h1>
					<h3>There was an error: </h3>
							<pre>${e.toString()}</pre>
					<p>You shouldn't have seen this error; please report to info@onilabs.com.</p>
					<p>
						To try again, reload the page or start over:
					</p>
					<p>
						<button class="reload btn">Reload page</button>
						<button class="restart btn">Start over</button>
					</p>
				`, {"class":"error-contents"})) {|elem|
					window.scrollTo(0,0);
					waitfor {
						elem.querySelector('button.reload') .. event.wait('click');
					} or {
						elem.querySelector('button.restart') .. event.wait('click');
						document.location.hash = "";
					}
				}
			}
			document.location.reload();
		} and {
			try {
				exports.run.apply(null, arguments);
			} catch(e) {
				error.set(e);
			}
		}
	};

	if (require.main === module) {
		exports.main(document.body);
	}
}
