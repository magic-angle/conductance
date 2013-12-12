/**
  @summary The default template for [surface::Document] objects.
  @desc
    This template includes twitter Bootstrap and jQuery.
*/

exports.Document = settings ->
  "\
<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv='Content-Type' content='text/html; charset=UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <link rel='stylesheet' href='/__mho/surface/bootstrap/bootstrap-vanilla-3.css' media='screen'>
    #{ settings.head }
    #{ settings.script }
  </head>
  <body>#{settings.body}
    <script src='/__mho/surface/bootstrap/jquery-1.10.2.min.js'></script>
    <script src='/__mho/surface/bootstrap/bootstrap.min.js'></script>
  </body>
</html>";