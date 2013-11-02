/**
  // metadata for sjs:bundle:
  @require sjs:object
  @require sjs:array
  @require sjs:sequence
  @require sjs:compare
  @require sjs:debug
  @require sjs:function
  @require sjs:cutil
  @require sjs:quasi
  @require sjs:assert
  @require sjs:logging
  @require sjs:string
  @require sjs:events
  @require sjs:sys
  @require sjs:url

  @require mho:observable
  @require mho:surface
  @require mho:client/env
*/
@ = require(['sjs:object', 'sjs:sys']);

var modules = [
  {id:'sjs:object'},
  'sjs:array',
  'sjs:sequence',
  'sjs:compare',
  'sjs:debug',
  'sjs:function',
  'sjs:cutil',
  'sjs:quasi',
  {id:'sjs:assert', name:'assert'},
  {id:'sjs:logging', include:['print','debug','verbose','info','warn','error']},
  {id:'sjs:logging', name:'logging'},
  {id:'sjs:string', exclude: ['contains']},
  {id:'sjs:events', exclude: ['Stream', 'Queue']},
  {id:'sjs:sys', exclude: ['executable']},
  {id:'sjs:url', name: 'url'},
  
  {id:'mho:observable', exclude: ['at', 'get']},
  {id:'mho:observable', name: 'observable'},
  {id:'mho:surface'}
];

if (@hostenv === 'nodejs') {
  modules = modules.concat([
    {id:'nodejs:path', name: 'path'},
    {id:'sjs:nodejs/fs', name: 'fs'},
    {id:'sjs:nodejs/child-process', name: 'childProcess'},
    {id:'mho:server/env', name:'env'},
    {id:'mho:server', include:['Host', 'Route', 'Port']},
    {id:'mho:server', name:'server'},
    {id:'mho:server/routes', name:'routes'},
    'mho:server/response',
    'mho:server/generator',
  ]);
} else {
  modules = modules.concat([
    {id: 'mho:client/env', name: 'env'}
  ]);
}

exports .. @extend(require(modules));

