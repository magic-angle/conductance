@ = require('../lib/common');
@context {||
@addTestHooks();

@context("App deploy") {||
	@test("deploy a simple app") {|s|
		s .. @actions.signup(true);
		var appList = @waitforSuccess(s.appList);
		appList .. @map(el -> el.textContent) .. @assert.eq([]);
		s.createAppButton() .. s.driver.click();
		var form = @waitforSuccess( -> s.modal('form'));
		var appPath = @stub.testPath('integration/fixtures/hello_app');
		form .. s.fillForm({
			name: 'My cool app',
			path: appPath,
		});
		form .. @trigger('submit');
		s.waitforNoModal();
		var appList;
		@waitforCondition(-> (appList = s.appList()).length > 0);
		appList .. @map(el -> el.textContent) .. @assert.eq(['My cool app']);
		appList[0] .. @elem('a') .. s.driver.click();

		var main = s.driver.elem('.app-display');
		var appLink = @waitforSuccess(-> main .. @elem('h3 a', el -> el.textContent === 'My cool app')).getAttribute('href') + 'ping';
		// show the console output, for debugging
		var outputToggle = @waitforSuccess( -> main .. @elem('.output-toggle'));
		outputToggle .. s.driver.click();
		main .. s.clickButton(/deploy/);
		var origUrl = @url.parse(appLink);
		var appId = origUrl.host.replace(/\.localhost.*$/, '');
		
		// XXX this is flaky, and doesn't really reflect reality. But it tests the basic proxy setup.
		var url = "http://localhost:#{@stub.getEnv('port-proxy-http')}/#{appId}/ping";
		console.log("Fetching: #{url}");
		@waitforSuccess(-> @stub.get(url, {headers: {'HOST': origUrl.host}}) .. @assert.eq('pong!'), null, 5);
	}
}
}.browserOnly();
