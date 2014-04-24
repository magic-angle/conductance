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
  @summary Utilities for time-varying values
*/


var cutil = require('sjs:cutil');
var { Stream, toArray, slice, integers, each, transform, first, skip } = require('sjs:sequence');

/**
  @class Observable
  @inherit sjs:sequence::Stream
  @summary A stream with 'observable' semantics
  @desc
    A stream is said to be an "observable" if it consists of a
    *temporal* sequence of values representing some changing state
    (e.g. that of an [::ObservableVar]). In contrast to an [sjs:event::EventStream]
    (e.g. a stream of 'click' events on a button), an observable always has
    a 'current' value, which can be accessed using [::current] (a synonym for [sjs:sequence::first]).
*/

/**
  @class ObservableVar
  @inherit ::Observable
  @summary An [::Observable] stream backed by a modifiable variable.

  @function ObservableVar
  @param {Object} [val] Initial value

  @function ObservableVar.get
  @summary Get the current observable value.

  @function ObservableVar.set
  @param {Object} [val] Value to set
  @summary Set a new observable value
  @desc
    **Note:** If this ObservableVar is shared by multiple pieces of
    code, it is typically better to use [::ObservableVar::modify], which
    will protect against concurrent modifications to the same object.

  @function ObservableVar.modify
  @summary Modify the current observable value
  @param {Function} [change]
  @desc

    `modify` allows you to change the current value of the ObservableVar
    without the possibility of race conditions. Consider:

        var increment = function(observable_var) {
          observable_var.set(count.get() + 1);
        };

    While the above code will work fine for a local observable_var object,
    it could silently drop data if either of `get`, `set` or the
    modification function may suspend, or if you forget to get()
    the latest value before setting the new one.

    Instead, the following code is safe under all conditions:

        var increment = function(observable_var) {
          observable_var.modify(val -> val + 1);
        };

    If the observable_var has not changed between the call to the
    `change` function and its return, the value will be updated atomically.

    If the value has changed, the return value from the `change` function
    is no longer necessarily correct, so `modify` throws a [::ConflictError]
    and does not update the value. If you expect multiple concurrent updates
    to a single observable_var, you should catch this exception yourself and
    retry as appropriate.

    ### Warning: avoid mutation

    It is highly recommended that the `change` function
    should be pure. That is, it should *not* modify the current
    value, but instead return a new value based on `current`.

    That is, **don't** do this:

        val.modify(function(items) { items.push(newItem); return items; });

    Instead, you should do this:

        val.modify(function(items) { return items.concat([newItem]); });

    If you mutate the current value but a conflict occurs with other
    code trying to modify the same value, the results will likely
    be inconsistent - the value may have changed, but no observers
    will be notified of the change.

    ### Cancelling a modification

    In some circumstances, you may call `modify`, only to find that
    the current value requires no modification. For this purpose,
    a sentinel value is provided as the second argument to `change`.
    If `change` returns this value, the modification is abandoned.

        var decrement = function(observable_var) {
          observable_var.modify(function(current, unchanged) {
            if (current == 0) return unchanged;
            return current - 1;
          }
        }

    This is better than simply returning the current value as the new
    value, as that would still cause observers to be notified of the
    "new" value.
*/

var unchanged = {};
function ObservableVar(val) {
  var rev = 1;
  var change = Object.create(cutil._Waitable);
  change.init();

  function wait(have_rev) {
    if (have_rev !== rev)
      return rev;
    return change.wait();
  }

  var rv = Stream(function(receiver) {
    var have_rev = 0;
    while (true) {
      wait(have_rev);
      have_rev = rev;
      receiver(val);
    }
  });

  rv.set = function(v) {
    val = v;
    change.emit(++rev);
  };

  rv.modify = function(f) {
    var newval;
    waitfor {
      change.wait();
      collapse;
      throw ConflictError("value changed during modification");
    } or {
      newval = f(val, unchanged);
    }
    if (newval !== unchanged) rv.set(newval);
  };

  rv.get = -> val;
  return rv;
}
exports.ObservableVar = ObservableVar;

/**
  @class ConflictError
  @inherits Error
  @summary The error raised by [::ObservableVar::modify] in the case of a conflict
*/
var ConflictErrorProto = new Error();
var ConflictError = exports.ConflictError = function(msg) {
  var rv = Object.create(ConflictErrorProto);
  rv.message = msg;
};

/**
  @function isConflictError
  @inherits Error
  @return {Boolean}
  @summary Return whether `e` is a [::ConflictError]
*/
exports.isConflictError = function(ex) {
  return Object.prototype.isPrototypeOf.call(ConflictErrorProto, ex);
};


/**
  @function observe
  @return [sjs:sequence::Stream]
  @summary Create stream of values derived from one or more [sjs:sequence::Stream] inputs (usually [::Observable]s).
  @param {sjs:sequence::Stream} [stream1, stream2, ...] Input stream(s)
  @param {Function} [transformer]
  @desc
    When the returned stream is being iterated, the `transformer` function will be called
    to generate the current value whenever one of the inputs changes.
    `transformer` is passed the most recent value of all inputs, in the same order
    they were passed to the `observe` function.

    If one of the inputs changes during execution of `transformer`, the execution will be
    aborted, and `transformer` will be called with the new set of inputs.

    For example, you might want to compute a derived property
    from a single observable variable:

        var person = ObservableVar({
          firstName: "John",
          lastName: "Smith",
        });

        var fullName = observe(person, function(current) {
          return "#{current.firstName} #{current.lastName}";
        });

    When `person` changes, `fullName` will be recomputed automatically, and
    any code iterating over `fullName` will see the new value immediately.

    You can create a observable stream from multiple source streams:

        var runner = ObservableVar({
          firstName: "John",
          lastName: "Smith",
          id: 5,
        });

        // The most recent race results:
        var latestRanking = ObservableVar([8, 2, 5, 7, 1, 3]);

        var personStatus = observe(runner, latestRanking, function(runnerVal, rankingVal) {
          return `$(runnerVal.firstName) came #$(rankingVal.indexOf(runner.id)+1) in the last race`;
        });

        // If `personStatus` is displayed in a [surface::HtmlFragment], the UI would
        // initially read "John came #3 in the last race", and would update
        // whenever `runner` or `latestRanking` changed.

*/
function observe(/* var1, ...*/) {
  var deps = arguments .. slice(0,-1) .. toArray;
  var f = arguments[arguments.length-1];

  return Stream(function(receiver) {
    var inputs = [], primed = 0, rev=1;
    var change = Object.create(cutil._Waitable);
    change.init();

    waitfor {
      var current_rev = 0;
      while (1) {
        change.wait();
        if (primed < deps.length) continue;
        while (current_rev < rev) {
          waitfor {
            change.wait();
          }
          or {
            current_rev = rev;
            var f_val = f.apply(null, inputs);
            collapse; // don't interrupt downstream call
            receiver(f_val);
          }
        }
      }
    }
    or {
      cutil.waitforAll(
        function(i) {
          var first = true;
          deps[i] .. each {
            |x|
            inputs[i] = x;
            if (first) {
              ++primed;
              first = false;
            }
            else
              ++rev;
            change.emit();
          }
        },
        integers(0,deps.length-1) .. toArray);
    }
  });
}
exports.observe = observe;


/**
   @function current
   @param {sjs:sequence::Stream} [obs] Stream (usually an [::Observable])
   @summary Obtain the current value of an [::Observable]; synonym for [sjs:sequence::first]
*/
exports.current = first;

/**
   @function changes
   @param {sjs:sequence::Stream} [obs] Stream (usually an [::Observable])
   @summary Obtain a stream of *changes* of an [::Observable], omitting the initial value; synonym for `skip(1)`.
*/
exports.changes = obs -> obs .. skip(1);

