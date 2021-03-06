@ = require(['mho:std','mho:surface/bootstrap']);
var serverRoot = @env.get('serverRoot', '/');
var frag = require('mho:surface/doc-fragment').configure({
  serverRoot: serverRoot,
});

var headerHeight = 120;
exports.globalCss = @GlobalCSS("
  html, body {
    height:100%;
  }
  body {
    > .container {
      min-height:100%;
      background: white;
      box-shadow: 0px 4px 20px rgba(0,0,0,0.3);
    }
    background: #555562;
    background: #49464B;
  }

  .clickable, a, button {
    cursor: pointer;
    &:hover {
      color: #2a6496;
    }
  }

  .reconnectNotification {
    /* clear the header */
    position: absolute !important;
    top: #{headerHeight + 15}px !important;
  }
");

exports.Center = @CSS("{text-align:center;}");
var headerStyle = @CSS("
  {
    position:relative;
    height: 100px;
    color: white;
    padding: 0 2em;
    border-bottom: 1px solid rgba(0, 0, 0, 0.2);
    background: top right no-repeat url('#{serverRoot}static/header-right.png') #B9090B;
    background-size: auto 100%;
    height: #{headerHeight}px;
  }
  img {
    position: absolute;
    left: 20px;
    top:0;
    height: 100%;
  }
");


exports.pageHeader = @Row([
  @Img({src:"#{serverRoot}static/header-left.svg", alt:"Conductance Seed"}),
]) .. @Attrib('id', 'pageHeader') .. headerStyle;

exports.defaultDocument = function(content, overrides) {
  overrides = overrides ? @clone(overrides) : {};

  // pre-extract fields that need to merge, rather than override
  var templateData = {
    showBusyIndicator: true,
    appModule: false,
    mhoStyle: false,
    bootstrapJs: false,
    //wrapContent: false
  } .. @merge(overrides.templateData || {});
  delete overrides.templateData;

  var init = overrides.init;
  delete overrides.init;

  return @Document([
    exports.globalCss,
    exports.pageHeader,
    content
  ], {
    title: overrides.title || "Conductance Seed",
    init: "
      require.hubs.push(['seed:', '#{serverRoot}modules/']);
      #{init || ""}
    ",
    templateData: templateData,
    template: docTemplate,
  } .. @merge(overrides));
};

// modified `app-default` template
var docTemplate = function(data, settings) {
  var showErrorDialog = true;
  var showBusyIndicator = settings.showBusyIndicator;
  var fluid = settings.fluid === true;
  var useMhoStyle = settings.mhoStyle !== false;
  var useBootstrapJs = settings.bootstrapJs !== false;

  var content = `<div class='${fluid?'container-fluid':'container'}'>${data.body}</div>`;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv='Content-Type' content='text/html; charset=UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    ${frag.bootstrapCss()}
    ${useMhoStyle ? frag.conductanceCss()}
    ${showErrorDialog ? frag.errorHandler()}
    ${frag.busyIndicator(showBusyIndicator, {
      //color:'#ff0',
      color:'#8CD2FF',
      thickness: 3,
      shadow: 3,
    })}
    ${ data.head }
    ${@Script(`
      withBusyIndicator {
        ||

        exports = module.exports = require([
          'mho:surface/bootstrap',
          { id:'mho:surface/api-connection', include: ['withAPI'] },
          { id:'mho:surface/bootstrap/notice', include: ['Notice'] }
        ]);


        // ui helpers:
        exports.body = document.body;
        exports.colors = ${JSON.stringify(useMhoStyle ? frag.mhoColors : frag.bootstrapColors)};
        exports.mainContent = document.body.firstChild;
        exports.withBusyIndicator = withBusyIndicator;
      }`, {'type':'text/sjs', module:'mho:app'})
    }
    ${ data.script }
  </head>
  <body>${content}
    ${useBootstrapJs ? frag.bootstrapJavascript()}
  </body>
</html>`;
}

