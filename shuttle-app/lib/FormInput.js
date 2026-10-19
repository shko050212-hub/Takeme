import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { C, formInput, formInputFocus } from './theme';

/** 웹 .form-input 과 같은 모양 (포커스 시 파란 테두리) */
export default function FormInput({ style, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={C.slate400}
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      style={[formInput, focused && formInputFocus, style]}
    />
  );
}
