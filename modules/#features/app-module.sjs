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

/**
@type doc
@summary Client-side application files
@desc
  The `.app` file format is intended to form
  the main logic of a client-side application.

  `.app` files contain Stratified JavaScript code, but are served by Conductance as HTML documents. 
  The file's code will be executed on the client-side on document load.

  ### Customizing how the `.app` file gets served

  Before serving the file, Conductance will scan any [sjs:#language/metadata::] comments 
  (those beginning with `/**`) for certain directives that allow you to control how exactly the app will be served.

  E.g. the [::@template] directive allows you to specify the template that is used to create the 
  app's initial HTML. 

  ### Templates

  Conductance comes with various built-in templates that can be found at 
  [surface/doc-template/::]. If no template is specified, `.app` files will use the 
  [surface/doc-template/app-default::] template.

  Metadata directives can also be used to set template-specific
  customization options. These are all prefixed with `@template-`, e.g.: `@template-title` ([surface/doc-template/app-default::@template-title]).

  ### 'mho:app' module

  Most document templates provide a module `mho:app` ([mho:app::]) with 
  application-specific functionality. The functionality provided by this 
  module varies from template to template; see the documentation for the 
  particular template for details on the symbols being made available.

  `mho:app` can be imported just like any other module,
  using [sjs:#language/builtins::require]. It can only be imported by
  client-side code, i.e. from the `*.app` file, and (transitively) from
  any modules loaded by the `*.app` file.

  The `mho:app` modules provided by Conductance's builtin templates
  have been carefully constructed so that there are no names that
  clash with `mho:std`. This enables you to use the common idiom of:

      @ = require(['mho:app', 'mho:std'])


  ### Code reuse

  `.app` files cannot be imported by other modules, so they are
  not an appropriate place for reusable code. Reusable code
  should typically be placed in separate `.sjs` modules (which you can load 
  into your `.app` file using [sjs:#language/builtins::require]).


@directive @template
@summary Use a custom HTML template
@desc
  To specify a template for a given `.app` file, use the @template
  directive inside a metadata comment.

  ### Example:

      /**
        @template plain
       *\/

  The list of builtin template names can be found at
  [surface/doc-template/::]. The default template for
  `.app` files is `app-default`.
  
  You can also specify a relative path if you wish to use your own
  template module. Custom templates will be loaded via
  [surface::loadTemplate].


@directive @bundle
@summary Bundle this module's dependencies in a single .js file
@desc
  By default, `.sjs` modules used by an `.app` are loaded
  individually, on-demand. If you include the `@bundle`
  directive, Conductance will serve up this app's code as
  a single file containing all required modules.

  This reduces the number of round-trips, but reduces the
  opportunity for caching - e.g different bundles will
  duplicate all common modules, and a change
  in any file will cause the entire bundle to
  be re-downloaded.

*/
