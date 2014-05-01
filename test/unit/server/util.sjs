@ = require('sjs:object');
@stream = require('sjs:nodejs/stream');
@url = require('sjs:url');

exports.mockRequest = function(settings) {
  settings = settings || {};
  var url = settings.url || 'http://example.com/';
  var method = settings.method || 'GET';
  return {
    url: @url.parse(url),
    request: {
      method: method,
      headers: settings.headers || {},
    },
    response: (new @stream.WritableStringStream()) .. @extend({
      headers: {},
      writeHead: (status) -> this.status = status,
      setHeader: (k,v) -> this.headers[k]=v,
    }),

    result: -> {
      status: this.response.status,
      headers: this.response.headers,
      body: this.response.data,
    }
  }
};
