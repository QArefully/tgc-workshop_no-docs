import { apiFetch } from './client';
import {
  PublicUser,
  CurrentUserResponse,
  type SignupBody,
  type LoginBody,
  type ForgotPasswordBody,
  type ResetPasswordBody,
  type ChangePasswordBody,
} from '@shop/contracts/auth';
import { SuccessResponse } from '@shop/contracts/common';

/** Auth API module — signup, login, logout, session, forgot/reset password, password change. */

export function signup(body: SignupBody): Promise<PublicUser> {
  return apiFetch(PublicUser, '/signup', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function login(body: LoginBody): Promise<PublicUser> {
  return apiFetch(PublicUser, '/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function logout(): Promise<SuccessResponse> {
  return apiFetch(SuccessResponse, '/logout', { method: 'POST' });
}

export function forgotPassword(body: ForgotPasswordBody): Promise<SuccessResponse> {
  return apiFetch(SuccessResponse, '/forgot-password', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function resetPassword(body: ResetPasswordBody): Promise<SuccessResponse> {
  return apiFetch(SuccessResponse, '/reset-password', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getMe(): Promise<PublicUser | null> {
  return apiFetch(CurrentUserResponse, '/me');
}

export function changePassword(body: ChangePasswordBody): Promise<SuccessResponse> {
  return apiFetch(SuccessResponse, '/password', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
