/**
 * Unit tests for InAppBrowserWarning component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InAppBrowserWarning } from '../InAppBrowserWarning';
import * as browserDetection from '../../utils/browserDetection';

// Mock the browser detection module
vi.mock('../../utils/browserDetection', () => ({
  isInAppBrowser: vi.fn(),
  canOpenInBrowser: vi.fn(),
  openInBrowser: vi.fn(),
}));

describe('InAppBrowserWarning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.location.href
    delete window.location;
    window.location = {
      href: 'https://example.com/test',
    };
  });

  // afterEach cleanup handled by vitest automatically

  describe('when not in in-app browser', () => {
    it('should render children instead of warning', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(false);

      render(
        <InAppBrowserWarning>
          <div>Test Content</div>
        </InAppBrowserWarning>
      );
      expect(screen.getByText('Test Content')).toBeInTheDocument();
      expect(screen.queryByText('無法在此瀏覽器中使用 Google 登入')).not.toBeInTheDocument();
    });

    it('should render null when no children provided', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(false);

      const { container } = render(<InAppBrowserWarning />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('when in in-app browser that cannot open in browser', () => {
    it('should show URL input immediately for Messenger', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(false);

      render(<InAppBrowserWarning actionText="完成註冊" />);

      expect(screen.getByText('無法在此瀏覽器中使用 Google 登入')).toBeInTheDocument();
      expect(screen.getByText('請複製以下連結，在系統預設瀏覽器中開啟此頁面以完成註冊。')).toBeInTheDocument();
      expect(screen.getByLabelText('請複製此連結：')).toBeInTheDocument();
      expect(screen.getByDisplayValue('https://example.com/test')).toBeInTheDocument();
      expect(screen.queryByText('在瀏覽器中開啟')).not.toBeInTheDocument();
    });

    it('should use custom actionText', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(false);

      render(<InAppBrowserWarning actionText="完成登入" />);

      expect(screen.getByText('請複製以下連結，在系統預設瀏覽器中開啟此頁面以完成登入。')).toBeInTheDocument();
    });
  });

  describe('when in in-app browser that can open in browser', () => {
    it('should show "open in browser" button initially', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(true);

      render(<InAppBrowserWarning actionText="完成註冊" />);

      expect(screen.getByText('無法在此瀏覽器中使用 Google 登入')).toBeInTheDocument();
      expect(screen.getByText('請點擊下方按鈕，在系統預設瀏覽器中開啟此頁面以完成註冊。')).toBeInTheDocument();
      expect(screen.getByText('在瀏覽器中開啟')).toBeInTheDocument();
      expect(screen.queryByLabelText('請複製此連結：')).not.toBeInTheDocument();
    });

    it('should show URL input when button fails immediately', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.openInBrowser).mockReturnValue(false);

      render(<InAppBrowserWarning actionText="完成註冊" />);

      const button = screen.getByText('在瀏覽器中開啟');
      fireEvent.click(button);

      expect(screen.getByLabelText('請複製此連結：')).toBeInTheDocument();
      expect(screen.queryByText('在瀏覽器中開啟')).not.toBeInTheDocument();
    });

    it('should show URL input after delay when button attempt succeeds but navigation fails', async () => {
      vi.useFakeTimers();
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.openInBrowser).mockReturnValue(true);

      render(<InAppBrowserWarning actionText="完成註冊" />);

      const button = screen.getByText('在瀏覽器中開啟');
      
      await act(async () => {
        fireEvent.click(button);
      });

      // Should still show button immediately
      expect(screen.queryByLabelText('請複製此連結：')).not.toBeInTheDocument();

      // Fast-forward time by 2 seconds
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      // After timeout, URL input should appear
      expect(screen.getByLabelText('請複製此連結：')).toBeInTheDocument();

      vi.useRealTimers();
    });

    it('should clean up timeout on unmount', () => {
      vi.useFakeTimers();
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.openInBrowser).mockReturnValue(true);

      const { unmount } = render(<InAppBrowserWarning />);

      const button = screen.getByText('在瀏覽器中開啟');
      fireEvent.click(button);

      // Unmount before timeout completes
      unmount();

      // Fast-forward time - should not cause errors
      vi.advanceTimersByTime(2000);

      vi.useRealTimers();
    });
  });

  describe('URL input field', () => {
    it('should select text when clicked', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(false);

      render(<InAppBrowserWarning />);

      const input = screen.getByDisplayValue('https://example.com/test') as HTMLInputElement;
      const selectSpy = vi.spyOn(input, 'select');

      fireEvent.click(input);

      expect(selectSpy).toHaveBeenCalled();
    });

    it('should be read-only', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(false);

      render(<InAppBrowserWarning />);

      const input = screen.getByDisplayValue('https://example.com/test') as HTMLInputElement;
      expect(input.readOnly).toBe(true);
    });

    it('should display current window location', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(false);

      window.location!.href = 'https://custom-url.com/page?param=value';

      render(<InAppBrowserWarning />);

      expect(screen.getByDisplayValue('https://custom-url.com/page?param=value')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have proper label for URL input', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(false);

      render(<InAppBrowserWarning />);

      const label = screen.getByText('請複製此連結：');
      const input = screen.getByLabelText('請複製此連結：');
      expect(label).toBeInTheDocument();
      expect(input).toBeInTheDocument();
    });

    it('should have warning icon', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(false);

      const { container } = render(<InAppBrowserWarning />);
      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });
  });

  describe('default actionText', () => {
    it('should use default actionText when not provided', () => {
      vi.mocked(browserDetection.isInAppBrowser).mockReturnValue(true);
      vi.mocked(browserDetection.canOpenInBrowser).mockReturnValue(false);

      render(<InAppBrowserWarning />);

      expect(screen.getByText(/在系統預設瀏覽器中開啟此頁面以完成操作/)).toBeInTheDocument();
    });
  });
});

