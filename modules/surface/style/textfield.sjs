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
   @nodoc
*/

@ = require([
  'sjs:std',
  {id:'./helpers', name: 'helpers'}
]);

//----------------------------------------------------------------------
// Surface Default Theme; heavily inspired by https://getmdl.io & https://material.io

var TextField = `
  .mho-textfield-container {
    vertical-align: top;
    display: inline-block;
  }
  .mho-textfield {
    vertical-align: top;
    line-height: normal;
    font-size: 16px;
    letter-spacing: 0.04em;

    display: inline-block;
    margin-bottom: 8px;
    will-change: opacity, transform, color;

    &__input {
      color: rgba(0,0,0,.87);
      padding: 0 0 8px;
      border: none;
      background: none;
      font-size: inherit;
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;

      &:focus {
        outline: none;
      }

      &:invalid {
        box-shadow: none; /* for firefox */
      }
    }

    &__label {

      &--not-initialized {
        display:none;
      }

      color: rgba(0,0,0,.38);
      position: absolute;
      bottom: 8px;
      left: 0px;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transform-origin: left top;
      transition: transform 180ms ${@helpers.Animation_curve_fast_out_slow_in}, color 180ms ${@helpers.Animation_curve_fast_out_slow_in}, width 180ms ${@helpers.Animation_curve_fast_out_slow_in};
      cursor: text;
      &--float-above {
        transform: translateY(-100%) scale(.75, .75);
        width: 133%;
        cursor: auto;
      }
    }

    /* these are 'upgraded' styles in mdc: */
    &:not(.mho-textfield-fullwidth) {
      display: inline-flex;
      position: relative;
      box-sizing: border-box;
      align-items: flex-end;
      -webkit-box-align: end;
      margin-top: 16px;
      &:not(.mho-textfield--multiline) {
        height: 48px;
        &::after {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 1px;
          transform: translateY(50%) scaleY(1);
          transform-origin: center bottom;
          transition: background-color 180ms ${@helpers.Animation_curve_fast_out_slow_in}, transform 180ms ${@helpers.Animation_curve_fast_out_slow_in};
          background-color: rgba(0,0,0,.12);
          content: "";
        }
      }
      &.mho-textfield--multiline {
        margin-top: 32px;
      }

      .mho-textfield__label {
        pointer-events: none;
      }
    }
  }

  .mho-textfield--focused {
    &:not(.mho-textfield--fullwidth):not(.mho-textfield--multiline)::after {
      background-color: var(--mho-theme-primary);
      transform: translateY(100%) scaleY(2);
      transition: transform 180ms ${@helpers.Animation_curve_fast_out_slow_in};
    }

    .mho-textfield__label {
      color: var(--mho-theme-primary);
    }
  }

  .mho-textfield--invalid {
    &:not(.mho-textfield--focused) {
      &::after {
        background-color: #d50000;
      }
      .mho-textfield__label {
        color: #d50000;
      }
    }
  }

  .mho-textfield--disabled {
    &::after {
      display: none;
    }
    .mho-textfield__input {
      padding-bottom: 7px;
    }

    border-bottom: 1px dotted rgba(35, 31, 32, .26);

    .mho-textfield__input,
    .mho-textfield__label,
    & + .mho-textfield-helptext {
      color: rgba(0,0,0, .38)
    }

    .mho-textfield__label {
      bottom: 7px;
      cursor: default;
    }
  }

  .mho-textfield__input:required + .mho-textfield__label::after {
    margin-left: 1px;
    content: "*";
  }
  .mho-textfield--focused .mho-textfield__input:required + .mho-textfield__label::after {
    color: #d50000;
  }

  .mho-textfield-helptext {
    line-height: normal;
    color: rgba(0,0,0,.38);
    margin: 0;
    transition: opacity 180ms ${@helpers.Animation_curve_fast_out_slow_in};
    font-size: 12px;
    opacity: 0;
    will-change: opacity;
  }
  .mho-textfield + .mho-textfield-helptext {
    margin-bottom: 8px;
  }
  .mho-textfield--focused + .mho-textfield-helptext {
    opacity: 1;
  }
  .mho-textfield-helptext--persistent {
    transition: none;
    opacity: 1;
    will-change: initial;
  }


  .mho-textfield--multiline {
    display: flex;
    height: initial;
    transition: none;

    &::after {
      content: initial; /* to get rid of underline bar */
    }

    .mho-textfield__input {
      padding: 4px;
      transition: border-color 180ms ${@helpers.Animation_curve_fast_out_slow_in};
      border: 1px solid rgba(0,0,0, .12);
      border-radius: 2px;

      &:focus {
        border-color: var(--mho-theme-primary);
      }

      &:invalid:not(:focus) {
        border-color: #d50000;
      }

    }

    .mho-textfield__label {
      top: 6px;
      bottom: initial;
      left: 4px;

      &--float-above {
        /* Translate above the top of the input, and compensate for the amount of offset needed
           to position the label within the bounds of the inset padding.
           Note that the scale factor is an eyeball'd approximation of what's shown in the mocks. */
        /* transform: translateY(calc(-100% - 6px)) scale(.923, .923);*/
        transform: translateY(calc(-100% - 6px)) translateX(-3px) scale(.75, .75);
      }
    }

    &.mho-textfield--disabled {
      border-bottom: none;

      .mho-textfield__input {
        border: 1px dotted rgba(35, 31, 32, .26);
      }
    }
  }

`;

exports.TextField = TextField;
