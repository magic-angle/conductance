#!/usr/bin/env conductance
// vim: syntax=sjs:
/*
  Construct a conductance stdlib based on the current SJS one,
  to prevent drift between the two
*/

@ = require('sjs:std');
var { @generateDocDescription } = require('sjs:../tools/document-stdlib');

var [target, _, stamp] = @argv();

var stdlibPath = require.resolve('sjs:std').path .. @url.toPath;
@childProcess.run('redo-ifchange', [stdlibPath]);
var baseStdlibContents = @fs.readFile(stdlibPath, 'utf-8').replace(/module\.exports *=(.|[\n\r])*/g, '');
var stdlibContents = (baseStdlibContents + "
/**
  // metadata for sjs:bundle:
  @require mho:observable
  @require mho:surface
  @require mho:env
*/

modules = modules.concat([
  {id:'mho:env', name:'env'},
  {id:'mho:observable', exclude: ['at', 'get']},
  {id:'mho:observable', name: 'observable'},
  {id:'mho:surface'}
]);

if (hostenv === 'nodejs') {
  modules = modules.concat([
    {id:'mho:server', include:['Host', 'Route', 'Port']},
    {id:'mho:server', name:'server'},
    {id:'mho:server/routes', name:'routes'},
    'mho:server/response',
    'mho:server/generator',
  ]);
}

module.exports = require(modules);
");

@verbose("CONTENTS:\n#{stdlibContents}");


var descriptionDocs = @generateDocDescription(stdlibContents, "
This module combines commonly-used functionality from the
Conductance and StratifiedJS standard libraries. It includes
everything from the [sjs:std::] SJS module, plus functionality
available only to conductance applications.

Typically, conductance applications and scripts will use this
module to access common functionality in a single line:

    @ = require('mho:stdlib');

(see also: [sjs:#language/syntax::@altns])

Below are a list of the symbols exposed in this module, with
links to the symbol's original module.
");

var output = "
/* ------------------------------------ *
* NOTE:                                *
*   This file is auto-generated        *
*   any manual edits will be LOST      *
* ------------------------------------ */
#{stdlibContents}
/**
@noindex
@summary Common functionality for conductance applications
#{descriptionDocs}
*/
";

@fs.writeFile(stamp, output);
@fs.writeFile('stdlib.sjs', output);

var proc = @childProcess.launch('redo-stamp', [], {'stdio':['pipe', null, null]});
proc.stdin .. @write(output);
proc.stdin.end();
proc .. @childProcess.wait();
