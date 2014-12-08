
var libModules = ['sjs:test/std'];
var api = require('./stub.api');

var isBrowser = require('sjs:sys').hostenv === 'xbrowser';
var driver;
if (isBrowser) {
	api = api.connect();
	libModules.push('sjs:xbrowser/driver');
	driver = require('sjs:xbrowser/driver');
}

var lib = @ = require(libModules);
var logging = require('sjs:logging');
var {HtmlOutput} = require('sjs:test/reporter');
lib.stub = api;

if (isBrowser) {
	var actions = lib.actions = {};
	actions.signup = function(s, activate) {
		s.waitforPanel(/Login/);
		var form = @waitforSuccess( -> s.modal('form'));
		form .. @elems('a') .. @find(el -> /register new account/.test(el.textContent)) .. s.driver.click();
		s.fillForm(form, s.creds, ['username','email','password']);
		form .. @trigger('submit');

		@waitforSuccess(-> s.modal('p', el -> /We've sent a confirmation email to/.test(el.textContent)));
		if(activate) {
			s .. actions.activate();
			s.modal('button') .. s.driver.click();
			s.waitforNoModal();
		}
	};

	actions.submitLogin = function(s, creds) {
		s.waitforPanel(/Login/);
		if(!creds) creds = s.creds;
		var form = @waitforSuccess( -> s.modal('form'));
		s.fillForm(form, creds, ['username', 'password']);
		form .. @trigger('submit');
	};

	actions.activate = function(s) {
		var email = @stub.emailQueue.get();
		var activationResponse = email .. s.activationLink() .. @http.get();
	};

	lib.visibleElements = function(elem, sel) {
		return elem .. @elems(sel) .. @filter(@isVisible);
	};

	lib.formInputs = function(elem) {
		var rv = {};
		elem .. @visibleElements('input') .. @each {|elem|
			rv[elem.getAttribute('name') .. @assert.ok(elem)] = elem;
		}
		return rv;
	};

	lib.contentPredicate = function(str) {
		if(!str) return -> true;
		if(@isString(str)) return function(el) {
			if (str === el.textContent) return true;
			return false;
		};
		if(@isString(str)) return el -> str === el.textContent;
		return el -> str.test(el.textContent);
	};


}

lib.addTestHooks = function(opts) {
	if(isBrowser) {
		lib.test.beforeAll {|s|
			s.modal = (sel, pred) -> s.driver.elem(".overlay #{sel ? sel : ""}", pred);
			s.hasModal = (sel, pred) -> s.driver.elems(".overlay #{sel ? sel : ""}", pred).length > 0;
			s.waitforPanel = function(title) {
				var matches = @isString(title) ? t -> t === title : t -> title.test(t);
				@waitforSuccess(function() {
					var panel = s.modal('.panel-title span');
					@assert.ok(matches(panel.textContent), "Panel title (#{panel.textContent}) doesn't match: #{title}");
				}, null, 5);
				return s.modal('.panel-body');
			}
			s.clickLink = (elem, text) -> elem .. @elems('a') .. @find(@contentPredicate(text)) .. s.driver.click();
			s.clickButton = (elem, text) -> elem .. @elems('button') .. @find(@contentPredicate(text)) .. s.driver.click();
			s.waitforNoModal = -> @waitforCondition(-> s.hasModal() === false, "modal dialog still present");
			s.creds = {
				username: "test1",
				email: "test@example.com",
				password: "secret",
			};
			s.activationLink = function(email) {
				var contents = email.response;
				var match = email.response.match(/activation code:\s+(https?:\/\/[^\r\n]+)/m);
				if(!match) throw new Error("Couldn't extract activation code from email:\n#{contents}");
				return match[1];
			};

			s.fillForm = function(form, props, expected) {
				var inputs = form .. @formInputs();
				var expectedFields = expected || props .. @ownKeys .. @toArray();
				if(expected !== false) {
					// check for completeness
					inputs .. @ownKeys .. @sort() .. @assert.eq(expectedFields .. @sort);
				}
				expectedFields .. @each {|key|
					var val = props .. @get(key);
					var elem = inputs[key];
					@info("Entering #{val} into elem #{elem}");
					elem .. @enter(val);
				}
			}

			s.appList = function() {
				return s.driver.elem('.app-list') .. @elems('li') .. @filter(e -> !e.classList.contains('new-app-button')) .. @toArray;
			};
			s.createAppButton = function() {
				return s.driver.elem('.app-list .new-app-button a');
			};
		}
	}

	var clearScope = opts && opts.clearAround || 'each';
	clearScope = clearScope.slice(0,1).toUpperCase() + clearScope.slice(1);
	var clearBeforeMethod = 'before' + clearScope;
	var clearAfterMethod = 'after' + clearScope;
	@assert.ok(clearBeforeMethod in lib.test, "Unknown method: #{clearBeforeMethod}");
	lib.test[clearBeforeMethod] {|s|
		api.clearData();
	}

	lib.test[clearAfterMethod] {|s|
		@info("Stopping all apps...");
		api.stopAllApps();
	}

	lib.test.beforeAll {|s|
		s.captureScreenshot = function() {
			if (isBrowser && HtmlOutput && HtmlOutput.instance) {
				// if we're running in a browser (manually; not under karma), we can inject
				// screenshots directly in log output
				var screenshot = s.driver.document().body .. require('sjs:xbrowser/html2canvas').render();
				HtmlOutput.instance.log("Captured screenshot:");
				HtmlOutput.instance.log(screenshot);
			} else {
				@logging.debug("Can't capture screenshot in this environment");
			}
		};

		s.screenshotOnFailure = function(block) {
			try { return block(); } catch(e) {
				s.captureScreenshot();
				throw e;
			}
		}
	}


	if (isBrowser) {
		lib.test.beforeAll {|s|
			s.driver = lib.Driver(@url.normalize('../../', module.id), {width:400, height:600});
		};

		lib.test.afterEach {|s, err|
			if (err) s.captureScreenshot();
		};

		driver.addTestHooks();

		lib.test.afterAll {|s|
			//hold(5000);
			s.driver.close();
		}
	}
};
module.exports = lib;
