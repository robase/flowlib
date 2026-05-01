import { TwoFactorVerifyForm, type TwoFactorVerifyFormProps } from './TwoFactorVerifyForm';
import { AuthPageShell } from './ui/auth-form';

export type TwoFactorVerifyPageProps = TwoFactorVerifyFormProps;

export function TwoFactorVerifyPage(props: TwoFactorVerifyPageProps) {
  return (
    <AuthPageShell>
      <TwoFactorVerifyForm {...props} />
    </AuthPageShell>
  );
}
