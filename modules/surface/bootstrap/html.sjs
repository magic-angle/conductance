/* (c) 2013-2014 Oni Labs, http://onilabs.com
 *
 * This file is part of Conductance, http://conductance.io/
 *
 * It is subject to the license terms in the LICENSE file
 * found in the top-level directory of this distribution.
 * No part of Conductance, including this file, may be
 * copied, modified, propagated, or distributed except
 * according to the terms contained in the LICENSE file.
 */

@ = require(['sjs:object', 'sjs:sequence', '../../surface', 'sjs:quasi']);

/**
  @summary Basic HTML elements with Bootstrap styling
  @desc
    This module defines basic HTML building blocks for documents that
    make use of the [Twitter Bootstrap](http://getbootstrap.com) CSS
    library that is built into Conductance.

    It exposes all of the symbols that are defined in the [../html::]
    module, but overrides styles where appropriate (e.g. the
    [::Button] element exposed by this module has the Bootstrap style
    classes `btn` and `btn-default` defined, whereas the
    [../html::Button] version does not). Only those symbols that have such
    custom styles are explicitly documented here. For the full list of symbols
    see the [../html::] module.

    When writing a Conductance client-side app
    ([mho:#features/app-file::]), you typically don't import this
    module yourself: Boostrap-enabled templates (such as
    [mho:surface/doc-template/app-default::]; see
    [mho:surface/doc-template/::] for a complete list) will expose all
    of the symbols in this module automatically in a dynamically
    generated [mho:app::] module.
*/

//----------------------------------------------------------------------
// BASIC HTML ELEMENTS, SPECIALIZED WITH BS STYLES

var base_html = require('../html');

// export all elements from surface/html.sjs:

exports .. @extend(base_html);

// ... and override with bootstrap specializations:

// XXX there has to be a better way to set the classes here
__js function wrapWithClass(baseElement, cls) {
  return () -> baseElement.apply(null, arguments) .. @Class(cls);
}

__js function callWithClass(baseElement, cls, content, attribs) {
  return baseElement.call(null, content, attribs) .. @Class(cls);
}

// XXX use of @Class this way is undocumented, but works
// for an array of non-observable class names
var wrapWithClasses = wrapWithClass;
var callWithClasses = callWithClass;

/**
  @function Button
  @param {surface::HtmlFragment} [content]
  @param {optional Object} [attribs]
  @summary Bootstrap-styled button (`<button class="btn btn-default">`)
  @return {surface::Element}
*/
exports.Button = wrapWithClasses(base_html.Button, ['btn', 'btn-default']);

/**
  @function Table
  @param {surface::HtmlFragment} [content]
  @param {optional Object} [attribs]
  @summary Bootstrap-styled table (`<table class="table">`)
  @return {surface::Element}
*/
exports.Table = wrapWithClass(base_html.Table, 'table');

/**
  @function Input
  @summary Bootstrap-styled input (`<input class="form-control">`)
  @param  {String} [type]
  @param  {String|sjs:sequence::Stream|sjs:observable::ObservableVar} [value] 
  @param  {optional Object} [attrs] Hash of DOM attributes to set on the element
  @return {surface::Element}
  @desc
    When the element is inserted into the document, its value 
    will be set to `value`. If `value` is a [sjs:sequence::Stream], the
    element's value will be updated every time `value` changes. If
    `value` is an [sjs:observable::ObservableVar] (as identified by being a
    [sjs:sequence::Stream] and having a `set` function), then `value` will
    be updated to reflect any manual changes to the element's value.
*/
exports.Input = wrapWithClass(base_html.Input, 'form-control');

/**
  @function TextInput
  @summary Bootstrap-styled [../html::TextInput] (with class "form-control")
  @param  {String|sjs:sequence::Stream|sjs:observable::ObservableVar} [value]
  @param  {optional Object} [attrs] Hash of DOM attributes to set on the element
  @return {surface::Element}
  @desc
    When the element is inserted into the document, its value
    will be set to `value`. If `value` is a [sjs:sequence::Stream], the
    element's value will be updated every time `value` changes. If
    `value` is an [sjs:observable::ObservableVar] (as identified by being a
    [sjs:sequence::Stream] and having a `set` function), then `value` will
    be updated to reflect any manual changes to the element's value.
*/
exports.TextInput = wrapWithClass(base_html.TextInput, 'form-control');

/**
  @function TextArea
  @param {surface::HtmlFragment} [content]
  @param {optional Object} [attribs]
  @summary Bootstrap-styled textarea (`<textarea class="form-control">`)
  @return {surface::Element}
*/
exports.TextArea = wrapWithClass(base_html.TextArea, 'form-control');

/**
  @function Select
  @param {Object} [settings]
  @param {optional Object} [attribs]
  @summary Bootstrap-styled [../html::Select] (with class "form-control")
  @return {surface::Element}
*/
exports.Select = wrapWithClass(base_html.Select, 'form-control');


// XXX remove
exports .. @extend(require('./components'));
