#!/usr/bin/env sjs
// vim: set syntax=sjs:
var childProcess = require('sjs:nodejs/child-process');
var fs = require('sjs:nodejs/fs');
var path = require('nodejs:path');
var { each, map, concat, filter, toArray, integers } = require('sjs:sequence');
var { contains } = require('sjs:array');
var assert = require('sjs:assert');
var { startsWith, endsWith } = require('sjs:string');

var run = (cmd, args) -> childProcess.run(cmd, args, {stdio:'inherit'});

var [target, _, tempfile] = require('sjs:sys').argv();
var dir = path.dirname(target);
var filename = path.basename(target);
if (dir == ".") {
	dir = target;
	filename = "";
}
var src = "src";

assert.ok(dir .. startsWith('step'), "invalid directory name #{dir} making #{target}");
var stepno = parseInt(dir.slice("step".length));

/*
 * Create directory, and ensure it doesn't have any
 * additional unwanted files
 */
var createDirectory = function(dir) {
	// ensure dir does not contain anything extra
	run('redo-ifchange', ['inputs']);
	var inputs = fs.readFile('inputs', 'utf-8').split("\n") .. filter() .. map(l -> l.replace(/\.md$/, ''));
	if (!fs.exists(dir)) {
		console.warn("Making #{dir}");
		fs.mkdir(dir);
	} else {
		fs.readdir(dir) .. each {|file|
			if (!inputs .. contains(file)) {
				var p = path.join(dir, file);
				console.warn("Removing #{p}");
				fs.unlink(p);
			}
		}
	}

	run('redo-ifchange', (inputs .. map(f -> path.join(dir, f))));
};

/*
 * Generate HTML from the input markdown
 */
var createHtml = function(source) {
	var sources = fs.readdir(src) .. map(f -> path.join(src, f));
	run('redo-ifchange', sources);
	console.log('
		<html>
		<link rel="stylesheet" href="/__mho/surface/bootstrap.css"/>
		<link rel="stylesheet" href="highlight.js/src/styles/xcode.css"/>
		<style>
			.filename {
				float:right;
				padding: 0.2em 1em 0.4em 1em;
				border-bottom-left-radius: 0.5em;
				color: #999;
				background:#ddd;
			}
			pre code {
				background: transparent !important;
				padding: 0 !important;
			}
		</style>
		<body>
		<article class="container">
	');

	var defines = ['DOC', "STEPNO=#{stepno}"];
	defines.push("STEP#{stepno}");
	defines.push("STEP#{stepno}_ONLY");

	var md = childProcess.run('../../tools/filepp', [source].concat(defines .. map(d -> "-D#{d}")), {stdio:[0,'pipe',2]}).stdout;
	assert.ok(md);
	var currentFile = null;
	// insert file markers
	md = md.replace(/^#+ File: ([^\n]*)|^((?:[^ \n].*?\n)(?:\s*\n)*)(     *\S)/gm, function(match, filename, pre, code) {
		if(filename) {
			currentFile = filename;
			return match;
		}
		return "#{pre}<span class=\"filename\">#{currentFile}</span>\n\n#{code}";
	});
	/*console.warn(md);*/

	var opts = {gfm:true};

	/* TODO:
	var hljs = require('nodejs:highlight.js');
	opts.highlight = function(code) {
		var hl = hljs.highlight('javascript', code);
		// console.warn(hl.value);
		return hl.value;
	};
	*/

	require('sjs:marked').convert(md, opts) .. console.log();

	console.log('
	</article>
	</body>
	</html>
	');
};


/*
 * generate source code
 * (i.e include only indented blocks from a file)
 */
function createCode(source) {
	var defines = integers(1, stepno) .. map(n -> "STEP#{n}");
	defines.push("STEP#{stepno}_ONLY");
	console.warn('defines: ', defines);
	var out = childProcess.run('../../tools/filepp',
		concat(
			defines .. map(flag -> "-D#{flag}"),
			[source]
		) .. toArray(),
		{stdio:[0,'pipe',2]}
	).stdout;

	var is_code = true;
	out.split("\n") .. each {|line|
		var old_is_code = is_code;
		is_code = line .. startsWith('    ');
		if (is_code) {
			if (!old_is_code) console.log();
			console.log(line.slice(4));
		}
	}
};



/******************************
 * actually build the target:
 ******************************/

if (!filename) {
	createDirectory(dir);
} else {
	// create file in `dir`
	var source = path.join(src, filename + '.md')
	run('redo-ifchange', [source])

	if (filename .. endsWith('.html')) {
		createHtml(source);
	} else {
		createCode(source);
	}
}


