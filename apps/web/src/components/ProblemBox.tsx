import { ApiProblem } from '../api';

/** Renders an RFC 7807 problem in plain language. */
export function ProblemBox({ error }: { error: unknown }) {
  if (!error) return null;
  const problem =
    error instanceof ApiProblem
      ? error.problem
      : { title: 'Something went wrong', detail: 'Please try again.' };

  return (
    <div className="problem" role="alert">
      <strong>{problem.title}</strong>
      {problem.detail}
    </div>
  );
}
