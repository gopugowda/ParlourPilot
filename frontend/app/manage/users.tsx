// Deprecated — replaced by the unified Team Management screen.
// Redirect any existing navigation to /manage/beauticians (Team).
import { Redirect } from 'expo-router';

export default function UsersScreenRedirect() {
  return <Redirect href="/manage/beauticians" />;
}
