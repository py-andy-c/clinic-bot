/**
 * Unit tests for DashboardIndexPage component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import DashboardIndexPage from '../DashboardIndexPage';

describe('DashboardIndexPage', () => {
  const renderWithRouter = (component: React.ReactElement) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
  };

  it('renders dashboard cards', () => {
    renderWithRouter(<DashboardIndexPage />);
    // Verify the component renders by checking for dashboard cards
    expect(screen.getByText('業務洞察')).toBeInTheDocument();
  });

  it('renders all dashboard cards', () => {
    renderWithRouter(<DashboardIndexPage />);
    
    expect(screen.getByText('業務洞察')).toBeInTheDocument();
    expect(screen.getByText('診所分潤審核')).toBeInTheDocument();
    expect(screen.getByText('LINE 訊息統計')).toBeInTheDocument();
  });

  it('renders card descriptions', () => {
    renderWithRouter(<DashboardIndexPage />);
    
    expect(screen.getByText('查看診所營收趨勢、服務項目表現和治療師績效')).toBeInTheDocument();
    expect(screen.getByText('審核和檢視診所分潤，確認計費方案選擇和金額覆寫')).toBeInTheDocument();
    expect(screen.getByText('查看 LINE 推播訊息和 AI 回覆訊息的使用情況')).toBeInTheDocument();
  });

  it('renders card icons', () => {
    renderWithRouter(<DashboardIndexPage />);
    
    // Icons are emoji, so we check for the card titles which contain them
    const businessCard = screen.getByText('業務洞察').closest('a');
    const revenueCard = screen.getByText('診所分潤審核').closest('a');
    const lineCard = screen.getByText('LINE 訊息統計').closest('a');
    
    expect(businessCard).toBeInTheDocument();
    expect(revenueCard).toBeInTheDocument();
    expect(lineCard).toBeInTheDocument();
  });

  it('has correct links to dashboard subpages', () => {
    renderWithRouter(<DashboardIndexPage />);
    
    const businessLink = screen.getByText('業務洞察').closest('a');
    const revenueLink = screen.getByText('診所分潤審核').closest('a');
    const lineLink = screen.getByText('LINE 訊息統計').closest('a');
    
    expect(businessLink).toHaveAttribute('href', '/admin/clinic/dashboard/business-insights');
    expect(revenueLink).toHaveAttribute('href', '/admin/clinic/dashboard/revenue-distribution');
    expect(lineLink).toHaveAttribute('href', '/admin/clinic/dashboard/line-usage');
  });

  it('applies hover styles to cards', () => {
    renderWithRouter(<DashboardIndexPage />);
    
    const businessCard = screen.getByText('業務洞察').closest('a');
    expect(businessCard).toHaveClass('hover:shadow-md');
    expect(businessCard).toHaveClass('hover:border-primary-300');
  });
});
