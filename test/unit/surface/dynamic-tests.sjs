var {test, context, assert} = require('sjs:test/suite');
context("dynamic") {||
@ =require(['sjs:test/std', 'mho:surface', 'sjs:sequence', 'sjs:observable', 'sjs:object', 'mho:surface/html']);

var {@ObservableVar, @observe} = require('sjs:observable');
@driver = require('sjs:xbrowser/driver');

var click = function(elem) {
  elem .. @driver.trigger('click');
  elem .. @driver.trigger('change');
}

context("void elements") {||
  test("should throw no errors") {||
    // testing for IE edge cases, mostly
    document.body .. @appendContent(@Element("img"), ->hold(100));
  }
}

context("observable widget content") {||
  test("should reflect changes made before & after insertion") {||
    var content = @ObservableVar("first");
    var observableElement = @Element("div", content);
    var computedElement = @Element("div", @observe(content, c -> 'computed ' + c));
    content.set("second");

    var widgets = [observableElement, computedElement];
    document.body .. @appendContent(widgets, function(/*elems ...*/) {
      var elems = arguments;
      elems.length .. assert.eq(widgets.length);

      elems .. @each {|elem|
        elem.textContent.split(' ') .. @at(-1) .. assert.eq("second");
      }

      content.set("third");

      elems .. @each {|elem|
        elem.textContent.split(' ') .. @at(-1) .. assert.eq("third");
      }
    });
  }
}

context("textarea widget") {||
  // textarea doesn't contain HTML, only values
  test("should contain contents") {||
    var obs = @ObservableVar("initial value");
    document.body .. @appendContent(@TextArea(obs)) {|elem|
      elem.value .. @assert.eq("initial value");
      obs.set("new value");
      hold(0);
      elem.value .. @assert.eq("new value");
    }
  }
}

context("select widget") {||
  var selectionMap = node -> node.childNodes .. @map(e -> e.selected);
  var withSelect = (settings, block) ->
      document.body .. @appendContent(@Select(settings), block);

  var commonTests = function() {
    test("should reflect static selections") {|s|
      withSelect({
        items: s.items,
        selected: "one",
      }) {|elem|
        elem .. selectionMap .. assert.eq([true, false, false]);
      }
    }

    test("should read selection object changes") {|s|
      var selection = @ObservableVar("one");
      withSelect({
        items: s.items,
        selected: selection,
      }) {|elem|
        elem .. selectionMap .. assert.eq([true, false, false], "initial");
        selection.set("two");
        elem .. selectionMap .. assert.eq([false, true, false]);
      }

      selection.set(["one", "two"]);
      withSelect({
        items: s.items,
        multiple: true,
        selected: selection,
      }) {|elem|
        elem .. selectionMap .. assert.eq([true, true, false], "initial");
        selection.set(["two", "three"]);
        elem .. selectionMap .. assert.eq([false, true, true]);
      }
    }

    test("should store selection object changes") {|s|
      var selection = @ObservableVar("one");
      withSelect({
        items: s.items,
        selected: selection,
      }) {|elem|
        elem .. selectionMap .. assert.eq([true, false, false], "initial");
        elem.childNodes[1] .. click();
        selection.get() .. assert.eq("two");
        elem .. selectionMap .. assert.eq([false, true, false]);
      }

      selection.set(["one", "two"]);
      withSelect({
        items: s.items,
        multiple: true,
        selected: selection,
      }) {|elem|
        elem .. selectionMap .. assert.eq([true, true, false], "initial");
        elem.childNodes[1] .. click();
        elem .. selectionMap .. assert.eq([true, false, false]);
        selection.get() .. assert.eq(['one']);
      }
    }
  };

  context("plain items") {||
    test.beforeEach {|s|
      s.items = ["one", "two", "three"];
    }
    commonTests();
  }

  context("observable collection") {||
    test.beforeEach {|s|
      s.items = @ObservableVar(["one", "two", "three"]);
    }
    commonTests();

    test("should maintain single selection on item change") {|s|
      var selection = @ObservableVar("one");
      withSelect({
        items: s.items,
        selected: selection,
      }) {|elem|
        elem .. selectionMap .. assert.eq([true, false, false], "initial");
        s.items.set(["zero", "one"]);
        elem .. selectionMap .. assert.eq([false, true]);
      }
    }

    test("should maintain multiple selection on item change") {|s|
      var selection = @ObservableVar(["one", "two"]);
      withSelect({
        items: s.items,
        selected: selection,
        multiple: true,
      }) {|elem|
        elem .. selectionMap .. assert.eq([true, true, false], "initial");
        s.items.set(["zero", "one", "two", "three"]);
        elem .. selectionMap .. assert.eq([false, true, true, false]);
      }
    }

    test("should use latest selection on item change if selection is observable") {|s|
      var selection = @ObservableVar(["one", "two"]);
      withSelect({
        items: s.items,
        selected: selection,
        multiple: true,
      }) {|elem|
        elem .. selectionMap .. assert.eq([true, true, false], "initial");
        selection.set(["zero"]);
        elem .. selectionMap .. assert.eq([false, false, false], "initial");
        s.items.set(["zero", "one"]);
        elem .. selectionMap .. assert.eq([true, false]);
      }
    }
  }
}

}.browserOnly();
